import { laneToX, PLAYER, type Lane } from "../core/config";
import { damp } from "../core/math";
import type { PlayerMotion } from "./types";

export interface JumpModifiers {
  superJump: boolean;
  jumpMultiplier: number;
  gravityScale: number;
}

/**
 * Runner kinematics. Pure state + integration; collision decisions live in the
 * CollisionSystem so each piece stays small and independently testable.
 */
export class Player {
  lane: Lane = 0;
  /** Lane the runner was in before the current lane change (target of a stumble bounce-back). */
  previousLane: Lane = 0;
  x = 0;
  y = 0;
  z = 0;
  vy = 0;
  grounded = true;
  groundY = 0;
  rollTimer = 0;
  stumbleTimer = 0;
  invulnerableTimer = 0;
  jumpBufferTimer = 0;
  coyoteTimer = 0;
  rollOnLand = false;
  flying = false;
  crashed = false;
  lastJumpWasSuper = false;

  reset(z: number): void {
    this.lane = 0;
    this.previousLane = 0;
    this.x = 0;
    this.y = 0;
    this.z = z;
    this.vy = 0;
    this.grounded = true;
    this.groundY = 0;
    this.rollTimer = 0;
    this.stumbleTimer = 0;
    this.invulnerableTimer = 0;
    this.jumpBufferTimer = 0;
    this.coyoteTimer = 0;
    this.rollOnLand = false;
    this.flying = false;
    this.crashed = false;
    this.lastJumpWasSuper = false;
  }

  get rolling(): boolean {
    return this.rollTimer > 0;
  }

  get height(): number {
    return this.rolling ? PLAYER.rollHeight : PLAYER.standHeight;
  }

  get invulnerable(): boolean {
    return this.invulnerableTimer > 0;
  }

  get changingLanes(): boolean {
    return Math.abs(this.x - laneToX(this.lane)) > PLAYER.laneSnapEpsilon * 4;
  }

  get motion(): PlayerMotion {
    if (this.crashed) return "crashed";
    if (this.flying) return "jetpack";
    if (this.stumbleTimer > 0.25) return "stumble";
    if (this.rolling) return "roll";
    if (!this.grounded) return this.vy > 0 ? "jump" : "fall";
    return "run";
  }

  /** @returns true when the lane actually changed (false at the track edge). */
  shiftLane(direction: -1 | 1): boolean {
    const next = this.lane + direction;
    if (next < -1 || next > 1) return false;
    this.previousLane = this.lane;
    this.lane = next as Lane;
    return true;
  }

  bounceBack(): void {
    this.lane = this.previousLane;
  }

  canJump(): boolean {
    return !this.flying && !this.crashed && (this.grounded || this.coyoteTimer > 0);
  }

  jump(modifiers: JumpModifiers): void {
    const height = (modifiers.superJump ? PLAYER.superJumpHeight : PLAYER.jumpHeight) * modifiers.jumpMultiplier;
    this.vy = Math.sqrt(2 * PLAYER.gravity * modifiers.gravityScale * height);
    this.grounded = false;
    this.coyoteTimer = 0;
    this.jumpBufferTimer = 0;
    this.rollTimer = 0;
    this.lastJumpWasSuper = modifiers.superJump;
  }

  /** Rolling mid-air slams the runner down and rolls on landing. */
  roll(): "rolled" | "slam" {
    if (!this.grounded) {
      this.vy = Math.min(this.vy, PLAYER.slamVelocity);
      this.rollOnLand = true;
      return "slam";
    }
    this.rollTimer = PLAYER.rollDuration;
    return "rolled";
  }

  integrateLateral(dt: number): void {
    const targetX = laneToX(this.lane);
    this.x = damp(this.x, targetX, PLAYER.laneSharpness, dt);
    if (Math.abs(this.x - targetX) < PLAYER.laneSnapEpsilon * 0.2) this.x = targetX;
  }

  /**
   * Applies gravity and resolves the floor.
   *
   * @returns "landed" on the frame the runner touches down
   */
  integrateVertical(dt: number, groundY: number, gravityScale: number): "landed" | "airborne" | "grounded" {
    this.groundY = groundY;
    if (this.grounded) {
      if (groundY < this.y - 0.05) {
        // Walked off a roof edge.
        this.grounded = false;
        this.coyoteTimer = PLAYER.coyoteTime;
      } else {
        this.y = groundY;
        this.vy = 0;
        return "grounded";
      }
    }
    const gravity = PLAYER.gravity * (this.vy < 0 ? gravityScale : 1);
    this.vy -= gravity * dt;
    this.y += this.vy * dt;
    this.coyoteTimer = Math.max(0, this.coyoteTimer - dt);
    if (this.y <= groundY) {
      this.y = groundY;
      this.vy = 0;
      this.grounded = true;
      if (this.rollOnLand) {
        this.rollOnLand = false;
        this.rollTimer = PLAYER.rollDuration;
      }
      return "landed";
    }
    return "airborne";
  }

  tickTimers(dt: number): void {
    this.rollTimer = Math.max(0, this.rollTimer - dt);
    this.stumbleTimer = Math.max(0, this.stumbleTimer - dt);
    this.invulnerableTimer = Math.max(0, this.invulnerableTimer - dt);
    this.jumpBufferTimer = Math.max(0, this.jumpBufferTimer - dt);
  }
}
