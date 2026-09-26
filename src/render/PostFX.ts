import * as THREE from "three";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { GTAOPass } from "three/examples/jsm/postprocessing/GTAOPass.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { ShaderPass } from "three/examples/jsm/postprocessing/ShaderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";

export type PostQuality = "low" | "medium" | "high";

/** Film-style finishing: split toning, contrast, vignette and fine grain (display-referred). */
const GradeShader = {
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    time: { value: 0 },
    vignette: { value: 0.32 },
    grain: { value: 0.035 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float time;
    uniform float vignette;
    uniform float grain;
    varying vec2 vUv;
    float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233)) + time * 13.7) * 43758.5453); }
    void main() {
      vec3 color = texture2D(tDiffuse, vUv).rgb;
      float luma = dot(color, vec3(0.2126, 0.7152, 0.0722));
      // Teal shadows, warm highlights.
      color += mix(vec3(-0.012, 0.004, 0.018), vec3(0.028, 0.012, -0.018), smoothstep(0.15, 0.85, luma));
      color = mix(vec3(luma), color, 1.06);
      color = (color - 0.5) * 1.05 + 0.5;
      vec2 centered = vUv - 0.5;
      color *= 1.0 - vignette * smoothstep(0.25, 0.85, dot(centered, centered) * 2.2);
      color += (hash(vUv * 1024.0) - 0.5) * grain;
      gl_FragColor = vec4(clamp(color, 0.0, 1.0), 1.0);
    }
  `,
};

/**
 * Cinematic post-processing chain: ambient occlusion (high), bloom on emissive
 * lights, ACES tone mapping, grading and MSAA. On "low" the scene renders
 * directly with tone mapping only.
 */
export class PostFX {
  private readonly composer: EffectComposer;
  private readonly gtao: GTAOPass;
  private readonly bloom: UnrealBloomPass;
  private readonly grade: ShaderPass;
  private quality: PostQuality = "high";
  private time = 0;

  constructor(
    private readonly renderer: THREE.WebGLRenderer,
    private readonly scene: THREE.Scene,
    private readonly camera: THREE.Camera,
  ) {
    const size = renderer.getSize(new THREE.Vector2());
    const target = new THREE.WebGLRenderTarget(size.x, size.y, { type: THREE.HalfFloatType, samples: 4 });
    this.composer = new EffectComposer(renderer, target);
    this.composer.addPass(new RenderPass(scene, camera));
    this.gtao = new GTAOPass(scene, camera, size.x, size.y);
    this.gtao.blendIntensity = 0.85;
    this.gtao.updateGtaoMaterial({ radius: 0.9, distanceExponent: 1.5, thickness: 1.2, scale: 1, samples: 12 });
    this.composer.addPass(this.gtao);
    this.bloom = new UnrealBloomPass(new THREE.Vector2(size.x, size.y), 0.4, 0.25, 10);
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());
    this.grade = new ShaderPass(GradeShader);
    this.composer.addPass(this.grade);
  }

  setQuality(quality: PostQuality): void {
    this.quality = quality;
    this.gtao.enabled = quality === "high";
    this.bloom.enabled = quality !== "low";
    const target = this.composer.renderTarget1;
    target.samples = quality === "high" ? 4 : 2;
    this.composer.renderTarget2.samples = target.samples;
  }

  setSize(width: number, height: number, pixelRatio: number): void {
    this.composer.setPixelRatio(pixelRatio);
    this.composer.setSize(width, height);
  }

  render(dt: number): void {
    if (this.quality === "low") {
      this.renderer.render(this.scene, this.camera);
      return;
    }
    this.time += dt;
    (this.grade.uniforms.time as THREE.IUniform).value = this.time % 100;
    this.composer.render(dt);
  }
}
