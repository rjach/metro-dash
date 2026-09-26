import type { AudioEngine } from "../audio/AudioEngine";
import type { GameSession } from "../game/GameSession";
import { MissionTracker, type MissionMetric, type MissionState } from "../game/missions";
import type { SaveStore } from "../persistence/SaveStore";
import type { HudScreen } from "../ui/screens/HudScreen";

const POLL_INTERVAL = 0.25;

/**
 * Feeds gameplay events into the mission tracker, celebrates completions and
 * persists progress (immediately on completion, otherwise when a run ends).
 */
export class MissionCoordinator {
  private tracker: MissionTracker;
  private pollClock = 0;

  constructor(
    private readonly session: GameSession,
    private readonly save: SaveStore,
    private readonly audio: AudioEngine,
    private readonly hud: HudScreen,
    private readonly isRunning: () => boolean,
  ) {
    this.tracker = new MissionTracker(save.data.missions);
    this.wire();
  }

  get snapshot(): MissionState {
    return this.tracker.snapshot;
  }

  startRun(): void {
    this.tracker = new MissionTracker(this.save.data.missions);
    this.tracker.startRun();
    this.pollClock = 0;
  }

  /** Score and distance missions are polled rather than event-driven. */
  update(dt: number): void {
    if (!this.isRunning()) return;
    this.pollClock -= dt;
    if (this.pollClock > 0) return;
    this.pollClock = POLL_INTERVAL;
    this.record("score", 0, this.session.stats.score);
    this.record("distance", 0, this.session.stats.distance);
  }

  private wire(): void {
    const events = this.session.events;
    const stats = this.session.stats;
    events.on("coin", () => this.record("coins", 1, stats.coins));
    events.on("jump", () => this.record("jumps", 1, stats.jumps));
    events.on("roll", () => this.record("rolls", 1, stats.rolls));
    events.on("laneChange", () => this.record("laneChanges", 1, stats.laneChanges));
    events.on("powerUpStart", ({ kind }) => {
      this.record("powerUps", 1, stats.powerUps);
      if (kind === "jetpack") this.record("jetpacks", 1, 0);
    });
    events.on("mysteryBox", (reward) => {
      this.record("mysteryBoxes", 1, 0);
      if (reward.kind === "coins") this.record("coins", reward.amount, stats.coins);
    });
    events.on("hoverboardStart", () => this.record("hoverboards", 1, stats.hoverboardsUsed));
  }

  private record(metric: MissionMetric, amount: number, runValue: number): void {
    if (!this.isRunning()) return;
    const update = this.tracker.record(metric, amount, runValue);
    for (const mission of update.completed) {
      this.audio.play("key");
      this.hud.toast("Mission complete!");
      this.hud.toast(mission.description, "info");
    }
    if (update.levelUp) {
      const { multiplier, reward } = update.levelUp;
      this.audio.play("newRecord");
      this.hud.toast(`Multiplier x${multiplier}!`);
      this.hud.toast(`Mission set complete · +${reward} coins`, "info");
      this.save.update((draft) => {
        draft.coins += reward;
      });
    }
    // Completed missions are saved immediately so they survive a closed tab.
    if (update.completed.length > 0) {
      const snapshot = this.tracker.snapshot;
      this.save.update((draft) => {
        draft.missions = snapshot;
      });
    }
  }
}
