import * as THREE from "three";

export interface SceneContext {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  /** The sun and sky fill light, driven by the house clock (see dayNight.ts). */
  sun: THREE.DirectionalLight;
  hemi: THREE.HemisphereLight;
}

/** Keep fill-rate predictable on Retina/large displays instead of blindly rendering at DPR 2. */
function renderPixelRatio(width: number, height: number): number {
  const deviceRatio = Math.min(window.devicePixelRatio || 1, 1.5);
  const maxDrawingBufferPixels = 1920 * 1080;
  return Math.max(0.5, Math.min(deviceRatio, Math.sqrt(maxDrawingBufferPixels / Math.max(1, width * height))));
}

/**
 * Standard materials pay for every visible point light. Keep the nearest few
 * active; the sun and hemisphere light still provide whole-house illumination.
 */
function installPointLightBudget(scene: THREE.Scene, camera: THREE.Camera, maxVisible = 6): void {
  let lights: THREE.PointLight[] | null = null;
  let nextUpdate = 0;
  const cameraPosition = new THREE.Vector3();
  const lightPosition = new THREE.Vector3();

  scene.onBeforeRender = () => {
    const now = performance.now();
    if (now < nextUpdate) return;
    nextUpdate = now + 200;
    if (!lights) {
      lights = [];
      scene.traverse((object) => {
        if (object instanceof THREE.PointLight) lights!.push(object);
      });
    }

    camera.getWorldPosition(cameraPosition);
    const nearest = lights
      .filter((light) => light.intensity > 0)
      .map((light) => ({ light, distance: light.getWorldPosition(lightPosition).distanceToSquared(cameraPosition) }))
      .sort((a, b) => a.distance - b.distance)
      .slice(0, maxVisible);
    const visible = new Set(nearest.map(({ light }) => light));
    for (const light of lights) light.visible = visible.has(light);
  };
}

/** Creates the renderer, scene, camera and lights, and keeps them sized to the window. */
export function setupScene(container: HTMLElement): SceneContext {
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(renderPixelRatio(window.innerWidth, window.innerHeight));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  container.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x9fd3f0);
  scene.fog = new THREE.Fog(0x9fd3f0, 45, 90);

  const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 200);

  // Soft sky/ground fill light so shadowed areas are never pitch black.
  const hemi = new THREE.HemisphereLight(0xdfefff, 0x6b5a45, 1.4);
  scene.add(hemi);

  // The "sun". One shadow-casting light covering the whole house.
  const sun = new THREE.DirectionalLight(0xfff1dc, 2.2);
  sun.position.set(-12, 30, 18);
  sun.target.position.set(0, 0, 8);
  sun.castShadow = true;
  sun.shadow.mapSize.set(1024, 1024);
  const s = sun.shadow.camera;
  s.left = -26;
  s.right = 26;
  s.top = 26;
  s.bottom = -26;
  s.near = 1;
  s.far = 80;
  sun.shadow.bias = -0.0005;
  scene.add(sun, sun.target);
  installPointLightBudget(scene, camera);

  window.addEventListener("resize", () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setPixelRatio(renderPixelRatio(window.innerWidth, window.innerHeight));
    renderer.setSize(window.innerWidth, window.innerHeight);
  });

  return { renderer, scene, camera, sun, hemi };
}
