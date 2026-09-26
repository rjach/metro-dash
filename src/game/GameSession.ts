import { CHASE, DIFFICULTIES, HEADSTART, HOVERBOARD, laneToX, MAGNET, PLAYER, REVIVE, SCORE, SIM, WORLD, type DifficultyTuning } from "../core/config";
import { EventBus } from "../core/EventBus";
import { clamp, damp, Random } from "../core/math";
import type { GameAction } from "./actions";
import { CollisionSystem } from "./CollisionSystem";
import { Player } from "./Player";
import { PowerUpSystem } from "./PowerUpSystem";
import { TrackGenerator } from "./TrackGenerator";
import {
  emptyRunStats,
  type ActivePowerUp,
  type Collectible,
  type CrashCause,
  type Obstacle,
  type RunStats,
  type SessionPhase,
  type TimedPowerUp,
} from "./types";
import { World } from "./World";

/** Per-run loadout derived from the player's profile (character, board, upgrades). */
export interface RunLoadout {
  powerUpDuration: (kind: TimedPowerUp) => number;
  baseMultiplier: number;
  hoverboards: number;
  hoverboardDuration: number;
  boardJumpMultiplier: number;
  boardMagnetRadius: number;
  boardGravityScale: number;
  /** Speed curve, spacing and forgiveness; defaults to Normal. */
  difficulty?: DifficultyTuning;
}

export type MysteryReward =
  { kind: "coins"; amount: number } | { kind: "hoverboard"; amount: number } | { kind: "key"; amount: number } | { kind: "powerUp"; powerUp: TimedPowerUp };

export interface GameEvents {
  phase: { phase: SessionPhase; previous: SessionPhase };
  coin: { total: number; x: number; y: number; z: number };
  key: { total: number };
  powerUpStart: { kind: TimedPowerUp; duration: number };
  powerUpEnd: { kind: TimedPowerUp };
  mysteryBox: MysteryReward;
  jump: { super: boolean };
  roll: { slam: boolean };
  land: { hard: boolean };
  laneChange: { direction: -1 | 1; lane: number };
  edgeBump: { direction: -1 | 1 };
  stumble: { caught: boolean };
  crash: { cause: CrashCause };
  hoverboardStart: { duration: number; remaining: number };
  hoverboardBreak: Record<string, never>;
  hoverboardEnd: Record<string, never>;
  revive: { count: number };
  multiplier: { value: number };
  trainIncoming: { lane: number };
  headstartStart: { distance: number };
  headstartEnd: Record<string, never>;
}

export type ChaseMode = "intro" | "hidden" | "alert" | "caught";

export interface ChaseState {
  mode: ChaseMode;
  /** 0 = far behind / off-screen, 1 = right on the runner's heels. */
  proximity: number;
}

const STUMBLE_GRACE = 0.5;
const STUMBLE_SPEED_PENALTY = 0.18;
const CRASH_SLOWMO_SECONDS = 0.9;

/**
 * The authoritative simulation for one endless run. It owns the world, the
 * runner and every gameplay system, consumes abstract GameActions, and reports
 * what happened through typed events. It has no knowledge of rendering, DOM,
 * audio or input devices.
 */
export class GameSession {
  readonly events = new EventBus<GameEvents>();
  readonly world = new World();
  readonly player = new Player();
  readonly stats: RunStats = emptyRunStats();
  readonly chase: ChaseState = { mode: "hidden", proximity: 0 };

  private readonly collisions = new CollisionSystem();
  private readonly powerUps: PowerUpSystem;
  private readonly generator: TrackGenerator;
  private rng: Random;
  private phaseValue: SessionPhase = "idle";
  private accumulator = 0;
  private runTime = 0;
  private speedPenalty = 0;
  private chaseTimer = 0;
  private stumbleGrace = 0;
  private crashTimer = 0;
  private hoverboardRemaining = 0;
  private hoverboardCooldown = 0;
  private hoverboardsLeft: number;
  private lastMultiplier = 1;
  private lastCrashCause: CrashCause | null = null;
  private seenMovingTrains = new Set<number>();
  /** Target z of an active headstart, or 0 when none is running. */
  private headstartUntil = 0;

  constructor(
    private loadout: RunLoadout,
    seed: number = Date.now(),
  ) {
    this.rng = new Random(seed);
    this.powerUps = new PowerUpSystem((kind) => this.loadout.powerUpDuration(kind));
    this.generator = new TrackGenerator(this.world, this.rng);
    this.hoverboardsLeft = loadout.hoverboards;
    this.resetRun(seed);
  }

  // ─── Queries ────────────────────────────────────────────────────────────

  get phase(): SessionPhase {
    return this.phaseValue;
  }

  private get tuning(): DifficultyTuning {
    return this.loadout.difficulty ?? DIFFICULTIES.normal;
  }

  get speed(): number {
    const tuning = this.tuning;
    const base = tuning.startSpeed + (tuning.maxSpeed - tuning.startSpeed) * (1 - Math.exp(-this.runTime / tuning.rampTimeConstant));
    return base * (1 - this.speedPenalty) * (this.headstartActive ? HEADSTART.speedMultiplier : 1);
  }

  get headstartActive(): boolean {
    return this.headstartUntil > 0;
  }

  /** Whether a headstart may still be triggered in this run. */
  get headstartAvailable(): boolean {
    return this.phaseValue === "running" && !this.headstartActive && this.stats.duration < HEADSTART.offerSeconds;
  }

  get difficulty(): number {
    return clamp(this.stats.distance / this.tuning.difficultyDistance, 0, 1);
  }

  get multiplier(): number {
    return this.loadout.baseMultiplier * (this.powerUps.isActive("multiplier") ? 2 : 1);
  }

  get activePowerUps(): ActivePowerUp[] {
    return this.powerUps.list();
  }

  get hoverboardActive(): boolean {
    return this.hoverboardRemaining > 0;
  }

  get hoverboardTimeLeft(): number {
    return this.hoverboardRemaining;
  }

  get hoverboardsAvailable(): number {
    return this.hoverboardsLeft;
  }

  get crashCause(): CrashCause | null {
    return this.lastCrashCause;
  }

  get obstacles(): readonly Obstacle[] {
    return this.world.obstacles;
  }

  get collectibles(): readonly Collectible[] {
    return this.world.collectibles;
  }

  get generatorStats() {
    return this.generator.stats;
  }

  isPowerUpActive(kind: TimedPowerUp): boolean {
    return this.powerUps.isActive(kind);
  }

  /** Key cost for the next revive in this run (doubles each time, like the genre standard). */
  get reviveCost(): number {
    return REVIVE.baseKeyCost * 2 ** this.stats.revives;
  }

  // ─── Lifecycle ──────────────────────────────────────────────────────────

  updateLoadout(loadout: RunLoadout): void {
    this.loadout = loadout;
    if (this.phaseValue === "idle") this.hoverboardsLeft = loadout.hoverboards;
  }

  /** Prepares a fresh, idle run (runner standing at the start line). */
  resetRun(seed: number = Date.now()): void {
    this.rng = new Random(seed);
    this.world.clear();
    this.player.reset(0);
    Object.assign(this.stats, emptyRunStats());
    this.powerUps.clear();
    this.generator.reset(0, this.rng);
    this.accumulator = 0;
    this.runTime = 0;
    this.speedPenalty = 0;
    this.chaseTimer = 0;
    this.stumbleGrace = 0;
    this.crashTimer = 0;
    this.hoverboardRemaining = 0;
    this.hoverboardCooldown = 0;
    this.hoverboardsLeft = this.loadout.hoverboards;
    this.lastMultiplier = this.multiplier;
    this.lastCrashCause = null;
    this.seenMovingTrains.clear();
    this.headstartUntil = 0;
    this.chase.mode = "hidden";
    this.chase.proximity = 0;
    this.generator.update(0, this.tuning.startSpeed, 0, this.tuning.gapScale);
    this.setPhase("idle");
  }

  start(): void {
    if (this.phaseValue !== "idle") return;
    this.chase.mode = "intro";
    this.chaseTimer = CHASE.introDuration;
    this.setPhase("running");
  }

  pause(): void {
    if (this.phaseValue === "running") this.setPhase("paused");
  }

  resume(): void {
    if (this.phaseValue === "paused") this.setPhase("running");
  }

  /** Continues a crashed run: clears the way ahead and grants temporary invulnerability. */
  revive(): boolean {
    if (this.phaseValue !== "crashed") return false;
    const z = this.player.z;
    this.world.clearRange(z - 6, z + REVIVE.clearAheadDistance);
    this.generator.clearRange(z - 6, z + REVIVE.clearAheadDistance);
    this.player.crashed = false;
    this.player.y = this.collisions.groundHeight(this.player, this.world.obstacles);
    this.player.vy = 0;
    this.player.grounded = true;
    this.player.rollTimer = 0;
    this.player.stumbleTimer = 0;
    this.player.invulnerableTimer = PLAYER.invulnerableAfterRevive;
    this.player.x = laneToX(this.player.lane);
    this.speedPenalty = 0;
    this.chase.mode = "hidden";
    this.stats.revives++;
    this.lastCrashCause = null;
    this.events.emit("revive", { count: this.stats.revives });
    this.setPhase("running");
    return true;
  }

  /** Ends a crashed run for good. */
  finish(): void {
    if (this.phaseValue === "crashed" || this.phaseValue === "paused" || this.phaseValue === "running") {
      this.setPhase("gameOver");
    }
  }

  // ─── Input ──────────────────────────────────────────────────────────────

  handleAction(action: GameAction): void {
    if (this.phaseValue !== "running") return;
    const player = this.player;
    switch (action) {
      case "left":
      case "right": {
        const direction = action === "left" ? -1 : 1;
        if (player.shiftLane(direction)) {
          this.stats.laneChanges++;
          this.events.emit("laneChange", { direction, lane: player.lane });
        } else {
          this.events.emit("edgeBump", { direction });
        }
        return;
      }
      case "jump":
        if (player.flying) return;
        if (player.canJump()) this.performJump();
        else player.jumpBufferTimer = this.tuning.jumpBufferTime;
        return;
      case "roll": {
        if (player.flying) return;
        const result = player.roll();
        this.stats.rolls++;
        this.events.emit("roll", { slam: result === "slam" });
        return;
      }
      case "hoverboard":
        this.activateHoverboard();
        return;
    }
  }

  /** Rockets the runner over the opening stretch of track. */
  startHeadstart(): boolean {
    if (!this.headstartAvailable) return false;
    const player = this.player;
    this.headstartUntil = player.z + HEADSTART.distance;
    player.flying = true;
    player.rollTimer = 0;
    this.chase.mode = "hidden";
    this.generator.spawnSkyCoins(player.z + 20, this.headstartUntil - 20);
    this.events.emit("headstartStart", { distance: HEADSTART.distance });
    return true;
  }

  activateHoverboard(): boolean {
    if (this.phaseValue !== "running" || this.hoverboardActive || this.hoverboardCooldown > 0 || this.hoverboardsLeft <= 0) return false;
    this.hoverboardsLeft--;
    this.hoverboardRemaining = this.loadout.hoverboardDuration;
    this.hoverboardCooldown = HOVERBOARD.activationCooldown;
    this.stats.hoverboardsUsed++;
    this.events.emit("hoverboardStart", { duration: this.loadout.hoverboardDuration, remaining: this.hoverboardsLeft });
    return true;
  }

  // ─── Simulation ─────────────────────────────────────────────────────────

  /** Advances the simulation by real elapsed time using a fixed internal step. */
  update(frameDelta: number): void {
    const delta = Math.min(frameDelta, SIM.maxFrameDelta);
    if (this.phaseValue === "crashed") {
      this.crashTimer += delta;
      return;
    }
    if (this.phaseValue !== "running") return;
    this.accumulator += delta;
    while (this.accumulator >= SIM.fixedStep) {
      this.accumulator -= SIM.fixedStep;
      this.step(SIM.fixedStep);
      if (this.phaseValue !== "running") {
        this.accumulator = 0;
        break;
      }
    }
    this.generator.update(this.player.z, this.speed, this.difficulty, this.tuning.gapScale);
    this.world.despawnBehind(this.player.z);
    this.announceIncomingTrains();
  }

  /** Seconds since the crash, used by presentation layers to time the slow-motion beat. */
  get timeSinceCrash(): number {
    return this.crashTimer;
  }

  get crashSettled(): boolean {
    return this.crashTimer >= CRASH_SLOWMO_SECONDS;
  }

  private step(dt: number): void {
    const player = this.player;
    this.runTime += dt;
    this.stats.duration += dt;
    this.speedPenalty = damp(this.speedPenalty, 0, 1.2, dt);
    const speed = this.speed;

    player.tickTimers(dt);
    this.stumbleGrace = Math.max(0, this.stumbleGrace - dt);
    this.hoverboardCooldown = Math.max(0, this.hoverboardCooldown - dt);

    player.integrateLateral(dt);
    this.stepVertical(dt);

    const previousZ = player.z;
    player.z += speed * dt;
    this.stats.distance = player.z;
    this.world.step(dt);

    this.resolveObstacles(previousZ, dt);
    if (this.phaseValue !== "running") return;

    this.updateCollectibles(dt, speed);
    this.tickHeadstart();
    this.tickPowerUps(dt);
    this.tickHoverboard(dt);
    this.tickChase(dt);

    const multiplier = this.multiplier;
    this.stats.score += speed * dt * SCORE.pointsPerMetre * multiplier;
    if (multiplier !== this.lastMultiplier) {
      this.lastMultiplier = multiplier;
      this.events.emit("multiplier", { value: multiplier });
    }
  }

  private performJump(): void {
    const superJump = this.powerUps.isActive("sneakers");
    this.player.jump({
      superJump,
      jumpMultiplier: this.hoverboardActive ? this.loadout.boardJumpMultiplier : 1,
      gravityScale: this.gravityScale,
    });
    this.stats.jumps++;
    this.events.emit("jump", { super: superJump });
  }

  private get gravityScale(): number {
    return this.hoverboardActive ? this.loadout.boardGravityScale : 1;
  }

  private stepVertical(dt: number): void {
    const player = this.player;
    if (player.flying) {
      player.y = damp(player.y, WORLD.jetpackAltitude, 3, dt);
      player.vy = 0;
      player.grounded = false;
      return;
    }
    const ground = this.collisions.groundHeight(player, this.world.obstacles);
    const wasFalling = player.vy < -14;
    const result = player.integrateVertical(dt, ground, this.gravityScale);
    if (result === "landed") {
      this.events.emit("land", { hard: wasFalling });
      if (player.jumpBufferTimer > 0) this.performJump();
    }
  }

  private resolveObstacles(previousZ: number, dt: number): void {
    const player = this.player;
    if (player.flying) return;
    if (player.invulnerable) {
      const roof = this.collisions.embeddedRoof(player, this.world.obstacles);
      if (roof !== null) {
        player.y = roof;
        player.vy = 0;
        player.grounded = true;
      }
      return;
    }
    const hit = this.collisions.detectHit(player, this.world.obstacles, previousZ, dt);
    switch (hit.type) {
      case "none":
        return;
      case "stepUp":
        player.y = hit.obstacle.top;
        player.vy = 0;
        player.grounded = true;
        return;
      case "stumble":
        this.stumble();
        return;
      case "crash":
        // On forgiving difficulties a barrier only trips the runner; trains always count.
        if (this.tuning.forgivingBarriers && (hit.cause === "barrier" || hit.cause === "block") && !this.chaseClose) {
          this.stumble();
          player.invulnerableTimer = Math.max(player.invulnerableTimer, 0.6);
          return;
        }
        this.crashOrSave(hit.cause);
        return;
    }
  }

  private get chaseClose(): boolean {
    return this.chase.mode === "alert";
  }

  private stumble(): void {
    if (this.stumbleGrace > 0) return;
    const player = this.player;
    this.stumbleGrace = STUMBLE_GRACE;
    if (player.changingLanes) player.bounceBack();
    player.stumbleTimer = 0.6;
    this.speedPenalty = STUMBLE_SPEED_PENALTY;
    const caught = this.chase.mode === "alert" && !this.hoverboardActive;
    this.events.emit("stumble", { caught });
    if (caught) {
      this.crash("caught");
      return;
    }
    this.chase.mode = "alert";
    this.chaseTimer = CHASE.stumbleWindow;
  }

  private crashOrSave(cause: CrashCause): void {
    if (this.hoverboardActive) {
      this.hoverboardRemaining = 0;
      this.player.invulnerableTimer = PLAYER.invulnerableAfterBoardBreak;
      this.player.stumbleTimer = 0.4;
      this.events.emit("hoverboardBreak", {});
      return;
    }
    this.crash(cause);
  }

  private crash(cause: CrashCause): void {
    this.player.crashed = true;
    this.player.rollTimer = 0;
    this.lastCrashCause = cause;
    this.crashTimer = 0;
    if (cause === "caught") this.chase.mode = "caught";
    this.events.emit("crash", { cause });
    this.setPhase("crashed");
  }

  private updateCollectibles(dt: number, speed: number): void {
    const player = this.player;
    const magnetRadius = Math.max(this.powerUps.isActive("magnet") ? MAGNET.radius : 0, this.hoverboardActive ? this.loadout.boardMagnetRadius : 0);
    const centerY = player.y + player.height / 2;
    for (const item of this.world.collectibles) {
      if (item.collected) continue;
      const dz = item.z - player.z;
      if (dz > MAGNET.radius + 20 || dz < -3) continue;
      if (magnetRadius > 0 && item.kind === "coin" && !item.attracted) {
        const dx = item.x - player.x;
        if (dz < magnetRadius + 6 && dz > -1 && Math.abs(dx) < magnetRadius) item.attracted = true;
      }
      if (item.attracted) {
        // Homing: close the gap faster than the runner moves so coins never trail behind.
        const pull = (MAGNET.pullSpeed + speed) * dt;
        const tx = player.x - item.x;
        const ty = centerY - item.y;
        const tz = player.z + 0.3 - item.z;
        const distance = Math.hypot(tx, ty, tz);
        if (distance <= pull || distance < 0.4) {
          this.collect(item);
          continue;
        }
        item.x += (tx / distance) * pull;
        item.y += (ty / distance) * pull;
        item.z += (tz / distance) * pull;
      }
      if (this.collisions.collects(player, item)) this.collect(item);
    }
  }

  private collect(item: Collectible): void {
    item.collected = true;
    switch (item.kind) {
      case "coin":
        this.stats.coins++;
        this.stats.score += SCORE.coinPoints * this.multiplier;
        this.events.emit("coin", { total: this.stats.coins, x: item.x, y: item.y, z: item.z });
        return;
      case "key":
        this.stats.keys++;
        this.events.emit("key", { total: this.stats.keys });
        return;
      case "mysteryBox":
        this.openMysteryBox();
        return;
      default:
        this.startPowerUp(item.kind);
    }
  }

  private startPowerUp(kind: TimedPowerUp): void {
    this.stats.powerUps++;
    const entry = this.powerUps.activate(kind);
    if (kind === "jetpack") {
      this.player.flying = true;
      this.player.rollTimer = 0;
      const z = this.player.z;
      this.generator.spawnSkyCoins(z + 12, z + this.speed * entry.duration * 0.95);
    }
    this.events.emit("powerUpStart", { kind, duration: entry.duration });
  }

  private openMysteryBox(): void {
    const reward = this.rng.weighted<MysteryReward>([
      { item: { kind: "coins", amount: this.rng.pick([50, 100, 150, 250]) }, weight: 0.5 },
      { item: { kind: "hoverboard", amount: 1 }, weight: 0.22 },
      { item: { kind: "key", amount: 1 }, weight: 0.1 },
      { item: { kind: "coins", amount: 500 }, weight: 0.06 },
      { item: { kind: "powerUp", powerUp: this.rng.pick<TimedPowerUp>(["magnet", "multiplier", "sneakers"]) }, weight: 0.12 },
    ]);
    switch (reward.kind) {
      case "coins":
        this.stats.coins += reward.amount;
        break;
      case "hoverboard":
        this.hoverboardsLeft += reward.amount;
        break;
      case "key":
        this.stats.keys += reward.amount;
        break;
      case "powerUp":
        this.startPowerUp(reward.powerUp);
        break;
    }
    this.events.emit("mysteryBox", reward);
  }

  private tickPowerUps(dt: number): void {
    for (const kind of this.powerUps.tick(dt)) {
      if (kind === "jetpack" && !this.headstartActive) {
        this.player.flying = false;
        this.player.grounded = false;
        this.player.vy = 0;
        this.player.invulnerableTimer = Math.max(this.player.invulnerableTimer, 1.4);
      }
      this.events.emit("powerUpEnd", { kind });
    }
  }

  private tickHeadstart(): void {
    if (!this.headstartActive || this.player.z < this.headstartUntil) return;
    this.headstartUntil = 0;
    const player = this.player;
    // Land somewhere safe: clear the touchdown zone and grant a moment of invulnerability.
    this.world.clearRange(player.z - 5, player.z + HEADSTART.landingClearance);
    this.generator.clearRange(player.z - 5, player.z + HEADSTART.landingClearance);
    if (!this.powerUps.isActive("jetpack")) {
      player.flying = false;
      player.grounded = false;
      player.vy = 0;
    }
    player.invulnerableTimer = Math.max(player.invulnerableTimer, 1.5);
    this.events.emit("headstartEnd", {});
  }

  private tickHoverboard(dt: number): void {
    if (this.hoverboardRemaining <= 0) return;
    this.hoverboardRemaining -= dt;
    if (this.hoverboardRemaining <= 0) {
      this.hoverboardRemaining = 0;
      this.events.emit("hoverboardEnd", {});
    }
  }

  private tickChase(dt: number): void {
    if (this.chase.mode === "hidden") {
      this.chase.proximity = damp(this.chase.proximity, 0, 2, dt);
      return;
    }
    this.chaseTimer -= dt;
    // Close enough to be on screen behind the runner: menacing at the start, right on the heels after a stumble.
    const target = this.chase.mode === "alert" ? 1 : 0.9;
    this.chase.proximity = damp(this.chase.proximity, this.chaseTimer > 0 ? target : 0, 3, dt);
    if (this.chaseTimer <= 0) this.chase.mode = "hidden";
  }

  private announceIncomingTrains(): void {
    for (const obstacle of this.world.obstacles) {
      if (obstacle.kind !== "movingTrain" || this.seenMovingTrains.has(obstacle.id)) continue;
      if (obstacle.z - this.player.z < 75) {
        this.seenMovingTrains.add(obstacle.id);
        this.events.emit("trainIncoming", { lane: obstacle.lane });
      }
    }
    if (this.seenMovingTrains.size > 32) {
      const live = new Set(this.world.obstacles.map((obstacle) => obstacle.id));
      for (const id of this.seenMovingTrains) if (!live.has(id)) this.seenMovingTrains.delete(id);
    }
  }

  private setPhase(phase: SessionPhase): void {
    const previous = this.phaseValue;
    if (previous === phase) return;
    this.phaseValue = phase;
    this.events.emit("phase", { phase, previous });
  }
}
