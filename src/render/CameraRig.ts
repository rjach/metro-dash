import * as THREE from "three";
import { damp } from "../core/math";

export type CameraMode = "menu" | "game" | "showcase";

export interface CameraTarget {
  playerX: number;
  playerY: number;
  speed: number;
  flying: boolean;
}

const BASE_FOV = 62;
const SWOOP_SECONDS = 1.1;

/**
 * Third-person follow camera with smooth transitions between the menu view
 * (facing the runner), the gameplay chase view and the character showcase.
 */
export class CameraRig {
  readonly camera: THREE.PerspectiveCamera;
  private mode: CameraMode = "menu";
  private readonly position = new THREE.Vector3(0, 2, 6);
  private readonly look = new THREE.Vector3(0, 1.2, 0);
  private shakeAmount = 0;
  private shakeEnabled = true;
  private transitionSharpness = 3;
  private cameraY = 3.3;
  /** Progress (0..1) of the scripted swoop from the menu view around to the chase view. */
  private swoop = 1;

  constructor(aspect: number) {
    this.camera = new THREE.PerspectiveCamera(BASE_FOV, aspect, 0.1, 400);
    this.snap({ playerX: 0, playerY: 0, speed: 0, flying: false });
  }

  setMode(mode: CameraMode, instant = false): void {
    if (mode === "game" && this.mode !== "game" && !instant) this.swoop = 0;
    this.mode = mode;
    this.transitionSharpness = mode === "game" ? 2.6 : 3.5;
    if (instant) this.snap({ playerX: 0, playerY: 0, speed: 0, flying: false });
  }

  get currentMode(): CameraMode {
    return this.mode;
  }

  setShakeEnabled(enabled: boolean): void {
    this.shakeEnabled = enabled;
  }

  shake(amount: number): void {
    if (this.shakeEnabled) this.shakeAmount = Math.max(this.shakeAmount, amount);
  }

  setAspect(aspect: number): void {
    this.camera.aspect = aspect;
    // Narrow portrait screens need a wider vertical FOV to keep all three lanes visible.
    this.camera.fov = aspect < 0.8 ? BASE_FOV + (0.8 - aspect) * 40 : BASE_FOV;
    this.camera.updateProjectionMatrix();
  }

  update(dt: number, target: CameraTarget): void {
    if (this.swoop < 1) {
      this.updateSwoop(dt, target);
      return;
    }
    const { desiredPosition, desiredLook } = this.desired(target);
    // The game view tracks lanes quickly; mode changes glide.
    const sharpness = this.mode === "game" && this.transitionSharpness > 6 ? 10 : this.transitionSharpness;
    this.position.set(
      damp(this.position.x, desiredPosition.x, sharpness * 1.5, dt),
      damp(this.position.y, desiredPosition.y, sharpness, dt),
      damp(this.position.z, desiredPosition.z, sharpness, dt),
    );
    this.look.set(
      damp(this.look.x, desiredLook.x, sharpness * 1.5, dt),
      damp(this.look.y, desiredLook.y, sharpness, dt),
      damp(this.look.z, desiredLook.z, sharpness, dt),
    );
    if (this.mode === "game") this.transitionSharpness = Math.min(12, this.transitionSharpness + dt * 4);

    this.camera.position.copy(this.position);
    if (this.shakeAmount > 0.001) {
      this.camera.position.x += (Math.random() - 0.5) * this.shakeAmount;
      this.camera.position.y += (Math.random() - 0.5) * this.shakeAmount;
      this.shakeAmount = damp(this.shakeAmount, 0, 7, dt);
    }
    this.camera.lookAt(this.look);
    const fovTarget =
      (this.camera.aspect < 0.8 ? BASE_FOV + (0.8 - this.camera.aspect) * 40 : BASE_FOV) + (this.mode === "game" ? Math.min(8, target.speed * 0.18) : 0);
    this.camera.fov = damp(this.camera.fov, fovTarget, 2, dt);
    this.camera.updateProjectionMatrix();
  }

  /**
   * Orbits from in front of the runner, around its side, to behind it — the
   * signature "turn and run" opening — instead of flying through the character.
   */
  private updateSwoop(dt: number, target: CameraTarget): void {
    this.swoop = Math.min(1, this.swoop + dt / SWOOP_SECONDS);
    const t = this.swoop;
    const eased = t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2;
    const angle = Math.PI * (1 - eased);
    const radiusZ = THREE.MathUtils.lerp(6.4, 4.8, (1 - Math.cos(angle)) / 2);
    const game = this.desired(target);
    this.position.set(
      Math.sin(angle) * 4.2 + game.desiredPosition.x * eased,
      THREE.MathUtils.lerp(1.9, game.desiredPosition.y, eased),
      Math.cos(angle) * radiusZ,
    );
    this.look.set(
      game.desiredLook.x * eased,
      THREE.MathUtils.lerp(1.25, game.desiredLook.y, eased),
      THREE.MathUtils.lerp(0, game.desiredLook.z, eased * eased),
    );
    this.camera.position.copy(this.position);
    this.camera.lookAt(this.look);
    this.camera.updateProjectionMatrix();
  }

  private snap(target: CameraTarget): void {
    const { desiredPosition, desiredLook } = this.desired(target);
    this.position.copy(desiredPosition);
    this.look.copy(desiredLook);
    this.camera.position.copy(this.position);
    this.camera.lookAt(this.look);
  }

  private desired(target: CameraTarget): { desiredPosition: THREE.Vector3; desiredLook: THREE.Vector3 } {
    switch (this.mode) {
      case "menu":
        return { desiredPosition: new THREE.Vector3(1.1, 1.9, -4.8), desiredLook: new THREE.Vector3(-0.3, 1.25, 0) };
      case "showcase": {
        // The details panel sits on the right in landscape and below in portrait; frame the runner in the free space.
        const portrait = this.camera.aspect < 1;
        return portrait
          ? { desiredPosition: new THREE.Vector3(0, 1.25, -3.9), desiredLook: new THREE.Vector3(0, -0.55, 0) }
          : { desiredPosition: new THREE.Vector3(-0.15, 1.3, -2.55), desiredLook: new THREE.Vector3(-0.72, 0.98, 0) };
      }
      case "game": {
        // Keep the camera from bobbing with every jump; follow roofs and flight smoothly.
        // Jumps barely move the camera; roofs and flight lift it so the view stays readable.
        const standing = Math.max(0, target.playerY - 1.7);
        this.cameraY = target.flying ? target.playerY + 2.6 : 3.1 + standing * 0.9 + Math.min(target.playerY, 1.7) * 0.25;
        return {
          desiredPosition: new THREE.Vector3(target.playerX * 0.72, this.cameraY, 6.2),
          desiredLook: new THREE.Vector3(target.playerX * 0.85, target.flying ? target.playerY - 0.6 : 1.1 + target.playerY * 0.75, -9),
        };
      }
    }
  }
}
