/**
 * Central gameplay tuning. All world units are metres; the player runs toward +z.
 * Everything that affects feel lives here so balancing never requires hunting
 * through systems.
 */
export const LANE_COUNT = 3;
export const LANE_WIDTH = 2.5;
export const LANES = [-1, 0, 1] as const;
export type Lane = (typeof LANES)[number];

export const laneToX = (lane: Lane): number => lane * LANE_WIDTH;

export const SIM = {
  /** Fixed simulation step; small enough that a 40 m/s runner never tunnels through a 0.5 m barrier. */
  fixedStep: 1 / 120,
  maxFrameDelta: 0.1,
} as const;

export const PLAYER = {
  halfWidth: 0.38,
  halfDepth: 0.35,
  standHeight: 1.7,
  rollHeight: 0.8,
  gravity: 42,
  jumpHeight: 1.65,
  superJumpHeight: 4.2,
  slamVelocity: -32,
  rollDuration: 0.62,
  laneSharpness: 20,
  /** A lane change is treated as complete once within this distance of the lane centre. */
  laneSnapEpsilon: 0.05,
  stepUpTolerance: 0.55,
  jumpBufferTime: 0.16,
  coyoteTime: 0.09,
  invulnerableAfterRevive: 2.5,
  invulnerableAfterBoardBreak: 1.6,
} as const;

export interface DifficultyTuning {
  startSpeed: number;
  maxSpeed: number;
  /** Seconds for the speed curve to cover ~63% of the start→max range. */
  rampTimeConstant: number;
  /** Distance (m) over which pattern difficulty grows from 0 to 1. */
  difficultyDistance: number;
  /** Multiplier on the open stretch between obstacle patterns. */
  gapScale: number;
  /** Head-on hits on barriers stumble instead of ending the run. */
  forgivingBarriers: boolean;
  jumpBufferTime: number;
}

/** Easy is the default: slower, roomier, and barriers only trip you up. */
export const DIFFICULTIES: Record<"easy" | "normal" | "hard", DifficultyTuning> = {
  easy: { startSpeed: 12, maxSpeed: 27, rampTimeConstant: 170, difficultyDistance: 8000, gapScale: 1.35, forgivingBarriers: true, jumpBufferTime: 0.24 },
  normal: { startSpeed: 15, maxSpeed: 34, rampTimeConstant: 110, difficultyDistance: 4500, gapScale: 1, forgivingBarriers: false, jumpBufferTime: 0.16 },
  hard: { startSpeed: 17, maxSpeed: 40, rampTimeConstant: 80, difficultyDistance: 3000, gapScale: 0.85, forgivingBarriers: false, jumpBufferTime: 0.12 },
};

export const CHASE = {
  introDuration: 3.2,
  stumbleWindow: 4.5,
} as const;

export const WORLD = {
  spawnAhead: 190,
  despawnBehind: 24,
  trainHeight: 3.1,
  trainWidth: 2.2,
  trainCarLength: 11,
  rampLength: 8.5,
  movingTrainSpeed: 11,
  lowBarrierHeight: 1.0,
  lowBarrierDepth: 0.5,
  highBarrierBottom: 1.12,
  highBarrierTop: 2.7,
  highBarrierDepth: 0.4,
  blockHeight: 2.3,
  blockDepth: 1.4,
  barrierWidth: 2.1,
  jetpackAltitude: 8.5,
  coinSpacing: 3.2,
  coinPickupRadius: 0.95,
  powerUpPickupRadius: 1.2,
} as const;

export const SCORE = {
  pointsPerMetre: 1,
  coinPoints: 5,
  maxBaseMultiplier: 10,
} as const;

export const MAGNET = {
  radius: 9,
  pullSpeed: 40,
} as const;

export const HOVERBOARD = {
  baseDuration: 30,
  activationCooldown: 0.5,
} as const;

export const HEADSTART = {
  distance: 750,
  speedMultiplier: 3.2,
  /** The offer is only valid at the very start of a run. */
  offerSeconds: 5,
  landingClearance: 80,
} as const;

export const REVIVE = {
  baseKeyCost: 1,
  offerSeconds: 5,
  clearAheadDistance: 70,
} as const;
