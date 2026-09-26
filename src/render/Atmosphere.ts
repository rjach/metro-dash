import * as THREE from "three";
import { Sky } from "three/examples/jsm/objects/Sky.js";

/**
 * Direction toward the sun: warm late-afternoon sun on the left, slightly
 * behind the runner — high enough that wall shadows shade one lane, not all three.
 */
const SUN_DIRECTION = new THREE.Vector3(-0.62, 0.58, 0.52).normalize();
const SUN_INTENSITY = 4.6;
const ENV_INTENSITY = 0.42;
const HAZE_DAY = new THREE.Color("#c9b9a2");
const HAZE_TUNNEL = new THREE.Color("#1a1816");

export type ShadowQuality = "off" | "medium" | "high";

/**
 * Physically based sky, sunlight and image-based lighting. The sky is baked
 * into a PMREM environment map so every PBR surface reflects the same
 * golden-hour light; a fitted shadow frustum follows the camera.
 */
export class Atmosphere {
  readonly sun: THREE.DirectionalLight;
  private readonly hemi: THREE.HemisphereLight;
  private readonly sky: Sky;
  private readonly fog: THREE.FogExp2;
  private readonly environment: THREE.Texture;
  private readonly baseExposure = 0.5;

  constructor(
    private readonly scene: THREE.Scene,
    private readonly renderer: THREE.WebGLRenderer,
  ) {
    this.sky = this.createSky();
    this.sky.scale.setScalar(4000);
    scene.add(this.sky);

    // Bake the sky into an environment map for reflections and ambient light.
    const pmrem = new THREE.PMREMGenerator(renderer);
    const envScene = new THREE.Scene();
    const envSky = this.createSky();
    envSky.scale.setScalar(1000);
    // The direct sun is already a light; leaving its disc out of the reflection map
    // stops glossy surfaces (glass towers, chrome) from blooming into white glare.
    (envSky.material.uniforms as Record<string, THREE.IUniform>).showSunDisc!.value = 0;
    envScene.add(envSky);
    this.environment = pmrem.fromScene(envScene, 0.02).texture;
    pmrem.dispose();
    scene.environment = this.environment;
    scene.environmentIntensity = ENV_INTENSITY;

    this.fog = new THREE.FogExp2(HAZE_DAY.clone(), 0.0068);
    scene.fog = this.fog;

    this.hemi = new THREE.HemisphereLight("#b9cdf0", "#5c4c3c", 0.35);
    scene.add(this.hemi);

    this.sun = new THREE.DirectionalLight("#ffdcb0", SUN_INTENSITY);
    this.sun.castShadow = true;
    const shadowCamera = this.sun.shadow.camera;
    shadowCamera.left = -15;
    shadowCamera.right = 15;
    shadowCamera.top = 30;
    shadowCamera.bottom = -30;
    shadowCamera.near = 1;
    shadowCamera.far = 160;
    this.sun.shadow.bias = -0.00035;
    this.sun.shadow.normalBias = 0.035;
    scene.add(this.sun);
    scene.add(this.sun.target);
  }

  setShadowQuality(quality: ShadowQuality): void {
    const enabled = quality !== "off";
    this.renderer.shadowMap.enabled = enabled;
    this.sun.castShadow = enabled;
    const size = quality === "high" ? 2048 : 1024;
    if (this.sun.shadow.mapSize.x !== size) {
      this.sun.shadow.mapSize.set(size, size);
      this.sun.shadow.map?.dispose();
      this.sun.shadow.map = null;
    }
    this.renderer.shadowMap.type = quality === "high" ? THREE.PCFSoftShadowMap : THREE.PCFShadowMap;
  }

  /**
   * @param focus - Point the shadow frustum centres on (just ahead of the runner)
   * @param tunnel - 0 in open air, 1 deep inside a tunnel
   */
  update(focus: THREE.Vector3, tunnel: number): void {
    this.sun.target.position.copy(focus);
    this.sun.position.copy(focus).addScaledVector(SUN_DIRECTION, 80);
    this.sun.intensity = THREE.MathUtils.lerp(SUN_INTENSITY, 0.05, tunnel);
    this.hemi.intensity = THREE.MathUtils.lerp(0.35, 0.12, tunnel);
    this.scene.environmentIntensity = THREE.MathUtils.lerp(ENV_INTENSITY, 0.1, tunnel);
    this.fog.color.copy(HAZE_DAY).lerp(HAZE_TUNNEL, tunnel);
    this.fog.density = THREE.MathUtils.lerp(0.0068, 0.014, tunnel);
    // Eye adaptation: open up the exposure inside tunnels.
    this.renderer.toneMappingExposure = this.baseExposure * THREE.MathUtils.lerp(1, 1.9, tunnel);
    this.sky.visible = tunnel < 0.98;
  }

  private createSky(): Sky {
    const sky = new Sky();
    const uniforms = sky.material.uniforms as Record<string, THREE.IUniform>;
    uniforms.turbidity!.value = 5.5;
    uniforms.rayleigh!.value = 1.4;
    uniforms.mieCoefficient!.value = 0.006;
    uniforms.mieDirectionalG!.value = 0.86;
    (uniforms.sunPosition!.value as THREE.Vector3).copy(SUN_DIRECTION);
    return sky;
  }
}
