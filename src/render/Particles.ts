import * as THREE from "three";
import { glowTexture } from "./textures";

interface Particle {
  alive: boolean;
  position: THREE.Vector3;
  velocity: THREE.Vector3;
  life: number;
  maxLife: number;
  size: number;
  gravity: number;
  color: THREE.Color;
  /** Particles tied to the track scroll backward with the world. */
  worldLocked: boolean;
  stretch: number;
}

export interface EmitOptions {
  count: number;
  position: THREE.Vector3;
  color: THREE.ColorRepresentation;
  speed: number;
  size: number;
  life: number;
  gravity?: number;
  spread?: THREE.Vector3;
  direction?: THREE.Vector3;
  worldLocked?: boolean;
  stretch?: number;
}

const CAPACITY = 400;

/**
 * Single-draw-call particle system (instanced additive billboards) for coin
 * sparkles, dust, board shatter and speed streaks. Particles are recycled
 * from a fixed-size pool.
 */
export class Particles {
  readonly mesh: THREE.InstancedMesh;
  private readonly particles: Particle[] = [];
  private cursor = 0;
  private readonly matrix = new THREE.Matrix4();
  private readonly scale = new THREE.Vector3();
  private readonly temp = new THREE.Vector3();
  private readonly stretchQuat = new THREE.Quaternion();

  constructor() {
    const material = new THREE.MeshBasicMaterial({
      map: glowTexture(),
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      fog: false,
    });
    this.mesh = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1), material, CAPACITY);
    this.mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(CAPACITY * 3), 3);
    this.mesh.frustumCulled = false;
    this.mesh.count = 0;
    for (let i = 0; i < CAPACITY; i++) {
      this.particles.push({
        alive: false,
        position: new THREE.Vector3(),
        velocity: new THREE.Vector3(),
        life: 0,
        maxLife: 1,
        size: 1,
        gravity: 0,
        color: new THREE.Color(),
        worldLocked: false,
        stretch: 1,
      });
    }
  }

  emit(options: EmitOptions): void {
    for (let i = 0; i < options.count; i++) {
      const particle = this.particles[this.cursor]!;
      this.cursor = (this.cursor + 1) % CAPACITY;
      particle.alive = true;
      particle.position.copy(options.position);
      if (options.spread) {
        particle.position.x += (Math.random() - 0.5) * options.spread.x;
        particle.position.y += (Math.random() - 0.5) * options.spread.y;
        particle.position.z += (Math.random() - 0.5) * options.spread.z;
      }
      if (options.direction) {
        particle.velocity.copy(options.direction).multiplyScalar(options.speed * (0.7 + Math.random() * 0.6));
      } else {
        particle.velocity
          .set(Math.random() - 0.5, Math.random() * 0.8 + 0.2, Math.random() - 0.5)
          .normalize()
          .multiplyScalar(options.speed * (0.5 + Math.random()));
      }
      particle.life = options.life * (0.7 + Math.random() * 0.6);
      particle.maxLife = particle.life;
      particle.size = options.size;
      particle.gravity = options.gravity ?? 0;
      particle.color.set(options.color);
      particle.worldLocked = options.worldLocked ?? false;
      particle.stretch = options.stretch ?? 1;
    }
  }

  /**
   * @param worldShift - Distance the world scrolled toward the camera this frame (+z)
   */
  update(dt: number, worldShift: number, camera: THREE.Camera): void {
    let count = 0;
    for (const particle of this.particles) {
      if (!particle.alive) continue;
      particle.life -= dt;
      if (particle.life <= 0) {
        particle.alive = false;
        continue;
      }
      particle.velocity.y -= particle.gravity * dt;
      particle.position.addScaledVector(particle.velocity, dt);
      if (particle.worldLocked) particle.position.z += worldShift;
      const t = particle.life / particle.maxLife;
      const size = particle.size * (0.4 + 0.6 * t);
      this.scale.set(size, size * particle.stretch, size);
      if (particle.stretch !== 1) {
        // Streaks point along their velocity.
        this.temp.copy(particle.velocity).normalize();
        this.stretchQuat.setFromUnitVectors(new THREE.Vector3(0, 1, 0), this.temp);
        this.matrix.compose(particle.position, this.stretchQuat, this.scale);
      } else {
        this.matrix.compose(particle.position, camera.quaternion, this.scale);
      }
      this.mesh.setMatrixAt(count, this.matrix);
      this.temp.set(particle.color.r * t, particle.color.g * t, particle.color.b * t);
      this.mesh.instanceColor!.setXYZ(count, this.temp.x, this.temp.y, this.temp.z);
      count++;
    }
    this.mesh.count = count;
    this.mesh.instanceMatrix.needsUpdate = true;
    this.mesh.instanceColor!.needsUpdate = true;
  }

  clear(): void {
    for (const particle of this.particles) particle.alive = false;
    this.mesh.count = 0;
  }
}
