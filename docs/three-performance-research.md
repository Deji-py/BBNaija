# Three.js performance research for BBNaija

Research date: 2026-10-10  
Scope: the browser client under `apps/client/src`, using Three.js `0.186.1`.

## Conclusion

The likely performance ceiling is not one exotic Three.js setting. The scene combines several multiplicative costs:

1. a drawing buffer of up to `2x` device pixel ratio (up to four times as many pixels as DPR 1),
2. a 2048² soft shadow map that redraws many shadow casters every frame,
3. hundreds of small meshes and scene nodes in the static house,
4. 25 point lights plus the sun and hemisphere light,
5. 260 individual confetti meshes or 350 individual firework meshes per effect,
6. animated character meshes with frustum culling explicitly disabled, and
7. several avoidable allocations and unchanged UI/state work inside every animation frame.

The best order is: **measure → dynamic resolution/quality tiers → batch particles → reduce shadow cost → batch static scenery by room/material → spatially limit lights and avatars → remove per-frame allocations/work**. Moving to WebGPU, adding LOD everywhere, or adding post-processing should not be the first intervention.

These are code-inspection findings, not runtime measurements. The application needs a repeatable benchmark before assigning exact percentages.

## What the repository is doing now

### Resolution and renderer

- `scene/setupScene.ts:14-18` enables MSAA, caps DPR at 2, and enables `PCFSoftShadowMap` globally.
- At DPR 2 the drawing buffer contains four times the pixels of DPR 1. The Three.js manual notes that DPR 3 means nine times the pixels and recommends limiting the drawing-buffer pixel count for heavy applications, especially on mobile ([Three.js responsive design](https://threejs.org/manual/pages/responsive.html)). MDN likewise recommends a smaller back buffer as a straightforward speed/quality trade ([MDN WebGL best practices](https://developer.mozilla.org/en-US/docs/Web/API/WebGL_API/WebGL_best_practices)).
- The avatar creator also uses DPR up to 2 and runs continuously (`ui/creator.ts:70-118`), even when its model is not changing.

### Shadows

- `scene/setupScene.ts:31-44` gives the sun a 2048² shadow map over a roughly 52×52-unit orthographic volume.
- `scene/materials.ts:37-40` makes every `box()` cast and receive shadows by default. The house is largely constructed from these boxes.
- `entities/avatar.ts:111-114` and `entities/character.ts:111-114` make avatar meshes cast shadows.
- `scene/dayNight.ts:74-96` updates the sun transform and lighting values every animation frame, even when the input minute has not changed.
- A shadow-casting light renders all shadow casters from the light's viewpoint before the normal scene render. Larger maps and larger shadow-camera volumes cost more; the official guide recommends the smallest map and volume that still work ([Three.js shadows](https://threejs.org/manual/pages/shadows.html)). `renderer.shadowMap.autoUpdate` may be disabled when shadows are static and refreshed explicitly with `needsUpdate` ([WebGLRenderer](https://threejs.org/docs/pages/WebGLRenderer.html)).

### Draw calls and scene graph size

- The source contains about 160 primitive geometry construction sites across `scene/` and `entities/`; many execute repeatedly for every wall finish, prop, furniture item, accessory, avatar, and effect.
- `scene/house.ts:280-340` constructs walls, decorative wall layers, floors, roofs, doors, furniture, and signs as individual meshes.
- `scene/partyRoom.ts:41-54` creates every dance-floor tile as its own geometry, material, mesh, and draw call.
- Three.js states that each mesh produces one or more drawing requests and demonstrates merging about 19,000 static boxes into one geometry to remove 18,999 operations ([Optimize Lots of Objects](https://threejs.org/manual/pages/optimize-lots-of-objects.html)).
- For repeated identical geometry and material, `InstancedMesh` is specifically intended to reduce draw calls ([InstancedMesh](https://threejs.org/docs/pages/InstancedMesh.html)). For different geometries with one material, `BatchedMesh` serves the same purpose and preserves per-object frustum culling ([BatchedMesh](https://threejs.org/docs/pages/BatchedMesh.html)).

### Party effects are an immediate hotspot

- One confetti event creates **260 meshes, 260 materials, and 260 vectors** (`scene/partyRoom.ts:186-194`).
- One fireworks event creates **350 meshes, 350 materials, and 350 vectors** over five timers (`scene/partyRoom.ts:197-211`).
- Every particle is individually advanced, rotated, removed, and spliced from an array each frame (`scene/partyRoom.ts:169-182`).
- The transparent, double-sided party beams (`scene/partyRoom.ts:71-74`) can require two draw calls each. Three.js documents that transparent double-sided objects normally render back and front separately; `forceSinglePass` avoids that when the visual result permits ([Material](https://threejs.org/docs/pages/Material.html)).

### Lights

- The scene creates 15 room point lights, one chandelier point light, five garden point lights, one pool point light, and three party point lights: **25 point lights** in addition to the directional sun and hemisphere light (`house.ts:90-118`, `house.ts:907`, `dayNight.ts:56-70`, `partyRoom.ts:119-125`).
- They do not cast shadows, which is good, but `MeshStandardMaterial` must still evaluate the active lights. Many lights combined with high DPR makes fragment shading expensive. Their finite `distance` values help visually, but should not be assumed to remove their shader cost without profiling.
- Many lights are turned “off” only by setting intensity to zero, not by removing them from the rendered light set.

### Avatars and animation

- Each character clones a skinned FBX hierarchy, creates its own material objects, and animation mixer (`entities/character.ts:102-128`).
- All skinned meshes set `frustumCulled = false` (`entities/character.ts:113-114`), so every avatar is submitted even when outside the camera view.
- `PlayersView.update()` advances every remote avatar every frame (`modes/playersView.ts:80-99`). This is reasonable for nearby visible players but provides no distance- or visibility-based animation update rate.
- The models use FBX. Three.js recommends glTF/GLB as the runtime format because it is compact and fast to load ([Loading 3D Models](https://threejs.org/manual/pages/loading-3d-models.html)). `GLTFLoader` supports Draco, Meshopt and KTX2 pipelines ([GLTFLoader](https://threejs.org/docs/pages/GLTFLoader.html)). This primarily improves load time/memory and may also improve asset organization; it is not a guaranteed FPS fix by itself.

### Culling, raycasting, and allocations

- Static meshes retain Three.js's default frustum culling, which is good. Static transforms also retain `matrixAutoUpdate = true`, so their local matrices are recomputed as part of scene updates despite never moving. Three.js documents disabling it and calling `updateMatrix()` once for static objects ([Matrix transformations](https://threejs.org/manual/pages/matrix-transformations.html)).
- `FollowCamera` correctly reuses its raycaster and vectors, limits ray distance, and tests only the `cameraBlockers` list (`scene/followCamera.ts:27-59`). This is already a good pattern. Raycaster layers and curated target lists are the official way to exclude irrelevant objects ([Raycaster](https://threejs.org/docs/pages/Raycaster.html)).
- `SpectatorCamera.update()` creates a new `Vector3` every frame while following (`scene/spectatorCamera.ts:74-81`), and another in `setMode()`.
- `Avatar.update()` creates a temporary four-element array each frame for each avatar (`entities/avatar.ts:198`). Other UI/state paths build arrays and sets every frame, including the shower-user set in `modes/housemate.ts:608`.
- These allocations are smaller than pixel, shadow, and draw-call costs, but can cause garbage-collection hitches once many avatars are active. Avoiding allocations is most valuable in the hot animation loop, after the larger GPU costs are addressed.

### Textures and post-processing

- Most current textures are small generated canvases and cached, so texture pressure is not the leading suspect. The 1024×220 hall sign is modest. VideoTexture upload can still be a cost while the TV is playing.
- Texture memory depends on decoded dimensions, not JPG/PNG download size; Three.js estimates ordinary mipmapped RGBA texture memory near `width × height × 4 × 1.33` and advises using the smallest dimensions that look acceptable ([Three.js textures](https://threejs.org/manual/pages/textures.html)).
- No `EffectComposer` or post-processing chain is present. Keep it that way until the base scene meets its frame budget: composer passes render through intermediate render targets and each pass adds work ([Three.js post-processing](https://threejs.org/manual/pages/post-processing.html)).

## Recommended implementation plan

### Phase 0 — establish a benchmark before changing visuals

Add a development-only performance overlay and capture the following once per second:

- FPS and frame-time percentiles (median, p95, worst), not just an instantaneous FPS number;
- `renderer.info.render.calls`, `triangles`, `points`, and `lines`;
- `renderer.info.memory.geometries`, `textures`, and `renderer.info.programs.length`;
- drawing-buffer width/height and effective DPR;
- visible/total avatars and active particle count;
- active light count and whether shadows/party/video are enabled.

`renderer.info` is the official source for draw and resource counts ([WebGLRenderer](https://threejs.org/docs/pages/WebGLRenderer.html)). Record Chrome Performance traces for four reproducible cases: empty house, maximum housemates, party/confetti, and night/TV. Chrome's Performance panel and Rendering stats overlay expose dropped frames, CPU work, and GPU activity ([Chrome DevTools Performance](https://developer.chrome.com/docs/devtools/performance), [Performance reference](https://developer.chrome.com/docs/devtools/performance/reference)).

Target representative devices, including a low-end Android phone. A 60 Hz display has 16.7 ms total per frame, while web.dev recommends budgeting about 10 ms for application work to leave browser overhead ([Rendering performance](https://web.dev/articles/rendering-performance)).

Use controlled toggles—DPR 1, shadows off, all-basic material override, lights reduced, particles off—to classify the bottleneck:

| Toggle | Large improvement means |
| --- | --- |
| DPR 2 → 1 | fragment/fill-rate or bandwidth bound |
| shadows off | shadow pass/caster count bound |
| shared `MeshBasicMaterial` override | lighting/material shader bound |
| particles off during party | draw-call / JS particle bound |
| hide static house decoration | scene graph / draw-call bound |
| pause avatar mixers | skinning/animation CPU or vertex bound |

For deep diagnostics, `EXT_disjoint_timer_query_webgl2` can measure GPU command duration without stalling, but support is limited, so treat it as optional instrumentation ([MDN timer query](https://developer.mozilla.org/en-US/docs/Web/API/EXT_disjoint_timer_query)).

### Phase 1 — add adaptive quality (highest return, lowest architectural risk)

1. Replace the fixed `min(devicePixelRatio, 2)` policy with quality tiers:
   - low/mobile: DPR or render scale 0.75–1.0, shadow map 512, optional MSAA off;
   - medium: DPR 1.0–1.25, shadow map 1024;
   - high: DPR up to 1.5–2.0, shadow map 2048.
2. Cap total drawing-buffer pixels, not only DPR. A large desktop window at DPR 2 can still be much more expensive than a phone.
3. Adapt slowly using sustained frame-time thresholds and hysteresis, not every frame. Drop quality quickly after repeated misses; raise it only after several stable seconds.
4. Persist a user's manual quality override. Do not infer capability only from user agent or `devicePixelRatio`.
5. Apply the same policy to the creator preview and stop that preview loop when hidden or disconnected.

This is likely the fastest path to a large improvement because it reduces the cost of every shaded pixel, MSAA sample, and screen-sized effect simultaneously.

### Phase 2 — replace party particles with one/few draw calls

1. Use one `InstancedMesh` for confetti and one for sparks, or use `Points` if camera-facing points are visually sufficient.
2. Store positions, velocities, lifetime and color in preallocated typed arrays. Reuse dead slots rather than allocating and splicing.
3. Update instance matrices/colors in one loop and mark the buffers dirty once per frame.
4. Reuse one geometry and one or a few shared materials. Avoid a material per particle.
5. Make the party beams single-sided if their outside is never visible; otherwise test `forceSinglePass` and accept it only if artifacts are tolerable.
6. Instance dance-floor tiles. Their emissive color can be an instance color or shader attribute.

This converts a burst from hundreds of meshes/draw calls/material objects to roughly one draw call per particle family.

### Phase 3 — reduce shadow cost

1. Audit every caster. Keep character shadows and a small set of large recognizable props; disable shadows for wall trim, signs, tiny accessories, bulbs, dishes, bottles, fence posts, and other detail meshes.
2. Default `box()` to no shadow, then opt important objects in explicitly. Today the opposite default makes new scenery automatically expensive.
3. Ship 1024² as the default shadow map and reserve 2048² for high quality.
4. Tighten the directional shadow camera to the visible/active region. The current volume covers the whole property at all times.
5. Avoid updating day/night and the sun when the minute value has not changed. If the sun is stepped at a reasonable cadence, request a shadow refresh only then.
6. Consider baked ambient occlusion/light textures or cheap blob/contact shadows for static furniture and distant avatars. Do not add shadow-casting point lights; an official Three.js point-light shadow requires six scene renders ([Three.js shadows](https://threejs.org/manual/pages/shadows.html)).

A fully static shadow map is not compatible with constantly moving avatars and sun. If dynamic character shadows must remain, selective casters and resolution/volume reductions are safer than globally setting `shadowMap.autoUpdate = false`.

### Phase 4 — batch the static house without destroying culling

1. Group static meshes by room/chunk and compatible material.
2. Within each room, use:
   - `InstancedMesh` for repeated identical primitives/materials (fence posts, bulbs, bottles, decorative repetitions);
   - merged `BufferGeometry` for immovable meshes that share a material;
   - `BatchedMesh` for different static geometries sharing a material when individual culling is useful.
3. Preserve separate dynamic objects: doors, TV/video screen, shower water, interactive props, lights, and party animation.
4. Do not merge the entire property into a single mesh. A global merge reduces draw calls but prevents room-level frustum/visibility culling and makes interaction awkward.
5. Freeze static matrices (`matrixAutoUpdate = false`; call `updateMatrix()` once).
6. Share primitive geometries by dimension where practical. Material caching already exists in `scene/materials.ts`; extend the same idea to common geometries.

`BufferGeometryUtils.mergeGeometries()` requires compatible attributes ([BufferGeometryUtils](https://threejs.org/docs/pages/module-BufferGeometryUtils.html)). Benchmark room-sized chunks because fewer calls can trade against overdraw and lost culling.

### Phase 5 — make light and avatar work spatial

1. Keep only lights relevant to the current room and adjacent doorway/garden region active in the renderer. Use room groups or layers, and benchmark changes because a changing light count can cause shader variants.
2. Replace decorative point lights with emissive meshes or baked illumination where they do not materially light characters.
3. Re-enable skinned-mesh frustum culling using conservative, animation-safe bounds. The current unconditional `frustumCulled = false` guarantees offscreen avatars render.
4. Add distance tiers for avatars:
   - near: full rig, accessories, shadow, 60 Hz animation;
   - medium: lower animation update rate, no tiny accessories/shadow;
   - far: simplified model or `LOD`, slower animation updates, labels only if readable.
5. Keep network interpolation at its required rate, but decouple expensive mixer/pose updates for far/offscreen avatars.

Three.js `LOD` switches objects by distance and supports hysteresis to avoid boundary flicker ([LOD](https://threejs.org/docs/pages/LOD.html)). `Object3D.frustumCulled` is enabled by default; disabling it should be a narrow exception ([Object3D](https://threejs.org/docs/pages/Object3D.html)).

### Phase 6 — hot-loop cleanup and lifecycle hardening

1. Reuse the spectator camera's target vector instead of constructing one per frame.
2. Avoid temporary arrays/sets in avatar and housemate loops; cache unchanged state and update DOM panels only when inputs change.
3. Throttle nonvisual work (HUD strings, needs panels, routing decisions) to state changes or 5–10 Hz where acceptable.
4. Make all scene modes dispose renderer resources and remove event listeners on leave. Stopping `setAnimationLoop()` alone does not release GPU resources.
5. Track `renderer.info.memory` across repeated enter/leave cycles. Three.js does not automatically dispose buffers, materials, textures, skeletons or render targets ([How to dispose objects](https://threejs.org/manual/pages/how-to-dispose-of-objects.html)).
6. Use `compileAsync(scene, camera)` after scene construction/loading if first movement shows shader-compilation stalls; it is the renderer's official asynchronous shader precompilation path ([WebGLRenderer](https://threejs.org/docs/pages/WebGLRenderer.html)).

## What not to do first

- **Do not start with WebGPU.** It can be valuable later, but it does not erase excessive pixels, lights, particles, shadow casters, or scene nodes. The existing bottlenecks should be fixed and measured under WebGL first.
- **Do not add bloom/SSAO/DOF yet.** Each pass introduces render targets and more pixel processing.
- **Do not globally disable frustum culling.** The character exception should be repaired with safe bounds, not generalized.
- **Do not merge the entire house into one mesh.** Batch in spatial chunks to retain culling.
- **Do not optimize triangle count blindly.** The present code more strongly suggests draw calls, fragment shading, shadow work, and JS/object overhead. Use measured `renderer.info.render.triangles` and GPU time before rebuilding every model.
- **Do not chase zero allocations before fixing DPR, particles, and shadows.** Allocation cleanup helps frame consistency, but it is unlikely to deliver the largest first gain here.

## Suggested success criteria

Test the same camera path and state for at least 60 seconds on every target tier:

| Tier | Goal | Drawing buffer | Party stress |
| --- | --- | --- | --- |
| Low-end mobile | stable 30 FPS, p95 ≤ 33 ms | adapt to ≤ DPR 1 equivalent | one effect without sustained drops |
| Mid mobile/laptop | stable 45–60 FPS, p95 ≤ 22 ms | DPR 1–1.25 | party + maximum housemates |
| Desktop high | stable 60 FPS, p95 ≤ 16.7 ms | DPR 1.5–2 when headroom exists | party + video + maximum housemates |

Also require:

- no unbounded rise in geometries/textures/programs after five enter/leave cycles;
- draw calls stay close to baseline when confetti/fireworks start;
- quality changes do not oscillate;
- no visible shadow popping, broken raycasting, or missing room objects after batching;
- no material/shader compilation hitch during the first camera tour after warm-up.

## Primary sources

- [Three.js: Optimize Lots of Objects](https://threejs.org/manual/pages/optimize-lots-of-objects.html)
- [Three.js: InstancedMesh](https://threejs.org/docs/pages/InstancedMesh.html)
- [Three.js: BatchedMesh](https://threejs.org/docs/pages/BatchedMesh.html)
- [Three.js: BufferGeometryUtils](https://threejs.org/docs/pages/module-BufferGeometryUtils.html)
- [Three.js: Responsive Design](https://threejs.org/manual/pages/responsive.html)
- [Three.js: Shadows](https://threejs.org/manual/pages/shadows.html)
- [Three.js: WebGLRenderer](https://threejs.org/docs/pages/WebGLRenderer.html)
- [Three.js: Object3D](https://threejs.org/docs/pages/Object3D.html)
- [Three.js: LOD](https://threejs.org/docs/pages/LOD.html)
- [Three.js: Raycaster](https://threejs.org/docs/pages/Raycaster.html)
- [Three.js: Textures](https://threejs.org/manual/pages/textures.html)
- [Three.js: Loading 3D Models](https://threejs.org/manual/pages/loading-3d-models.html)
- [Three.js: GLTFLoader](https://threejs.org/docs/pages/GLTFLoader.html)
- [Three.js: Post Processing](https://threejs.org/manual/pages/post-processing.html)
- [Three.js: How to dispose of Objects](https://threejs.org/manual/pages/how-to-dispose-of-objects.html)
- [MDN: WebGL best practices](https://developer.mozilla.org/en-US/docs/Web/API/WebGL_API/WebGL_best_practices)
- [MDN: EXT_disjoint_timer_query](https://developer.mozilla.org/en-US/docs/Web/API/EXT_disjoint_timer_query)
- [Chrome DevTools: Analyze runtime performance](https://developer.chrome.com/docs/devtools/performance)
- [web.dev: Rendering performance](https://web.dev/articles/rendering-performance)
