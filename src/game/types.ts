import type { Lane } from "../core/config";

export type ObstacleKind = "train" | "movingTrain" | "ramp" | "barrierLow" | "barrierHigh" | "block";

export type CollectibleKind = "coin" | "key" | PowerUpKind;

export type PowerUpKind = "magnet" | "jetpack" | "sneakers" | "multiplier" | "mysteryBox";

/** Timed power-ups; the mystery box is resolved instantly into another reward. */
export type TimedPowerUp = Exclude<PowerUpKind, "mysteryBox">;

export const TIMED_POWER_UPS: readonly TimedPowerUp[] = ["magnet", "jetpack", "sneakers", "multiplier"];

export interface Obstacle {
  id: number;
  kind: ObstacleKind;
  lane: Lane;
  x: number;
  /** Front face (nearest the approaching player). */
  z: number;
  length: number;
  width: number;
  /** Solid volume vertical extent. */
  bottom: number;
  top: number;
  /** Positive values move toward the player (−z). */
  speed: number;
  /** Visual variant index, interpreted by the renderer. */
  variant: number;
  /** Walkable roof height, or null for non-walkable obstacles. Ramps expose their slope via top. */
  walkable: boolean;
}

export interface Collectible {
  id: number;
  kind: CollectibleKind;
  x: number;
  y: number;
  z: number;
  collected: boolean;
  /** Pulled toward the player by the magnet. */
  attracted: boolean;
}

export type PlayerMotion = "run" | "jump" | "fall" | "roll" | "jetpack" | "stumble" | "crashed" | "idle";

export type CrashCause = "train" | "movingTrain" | "barrier" | "block" | "caught";

export type SessionPhase = "idle" | "running" | "paused" | "crashed" | "gameOver";

export interface ActivePowerUp {
  kind: TimedPowerUp;
  remaining: number;
  duration: number;
}

export interface RunStats {
  score: number;
  coins: number;
  keys: number;
  distance: number;
  duration: number;
  jumps: number;
  rolls: number;
  laneChanges: number;
  powerUps: number;
  hoverboardsUsed: number;
  revives: number;
}

export const emptyRunStats = (): RunStats => ({
  score: 0,
  coins: 0,
  keys: 0,
  distance: 0,
  duration: 0,
  jumps: 0,
  rolls: 0,
  laneChanges: 0,
  powerUps: 0,
  hoverboardsUsed: 0,
  revives: 0,
});
