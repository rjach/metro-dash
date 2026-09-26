import { TIMED_POWER_UPS, type ActivePowerUp, type TimedPowerUp } from "./types";

/** Tracks timed power-ups. Re-collecting an active power-up refreshes its timer. */
export class PowerUpSystem {
  private readonly active = new Map<TimedPowerUp, ActivePowerUp>();

  constructor(private readonly durationOf: (kind: TimedPowerUp) => number) {}

  activate(kind: TimedPowerUp): ActivePowerUp {
    const duration = this.durationOf(kind);
    const entry: ActivePowerUp = { kind, duration, remaining: duration };
    this.active.set(kind, entry);
    return entry;
  }

  /** @returns power-ups that expired during this tick */
  tick(dt: number): TimedPowerUp[] {
    const expired: TimedPowerUp[] = [];
    for (const [kind, entry] of this.active) {
      entry.remaining -= dt;
      if (entry.remaining <= 0) {
        this.active.delete(kind);
        expired.push(kind);
      }
    }
    return expired;
  }

  isActive(kind: TimedPowerUp): boolean {
    return this.active.has(kind);
  }

  end(kind: TimedPowerUp): void {
    this.active.delete(kind);
  }

  clear(): void {
    this.active.clear();
  }

  /** Stable ordering for the HUD. */
  list(): ActivePowerUp[] {
    return TIMED_POWER_UPS.flatMap((kind) => {
      const entry = this.active.get(kind);
      return entry ? [entry] : [];
    });
  }
}
