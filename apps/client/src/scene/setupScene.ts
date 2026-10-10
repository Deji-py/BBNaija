import * as THREE from "three";

export interface SceneContext {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  /** The sun and sky fill light, driven by the house clock (see dayNight.ts). */
  sun: THREE.DirectionalLight;
  hemi: THREE.HemisphereLight;
}

/** Creates the renderer, scene, camera and lights, and keeps them sized to the window. */
export function setupScene(container: HTMLElement): SceneContext {
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
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
  sun.shadow.mapSize.set(2048, 2048);
  const s = sun.shadow.camera;
  s.left = -26;
  s.right = 26;
  s.top = 26;
  s.bottom = -26;
  s.near = 1;
  s.far = 80;
  sun.shadow.bias = -0.0005;
  scene.add(sun, sun.target);

  window.addEventListener("resize", () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  });

  return { renderer, scene, camera, sun, hemi };
}
