import { Random } from "../core/math";

/** Gameplay signals missions can count. */
export type MissionMetric = "coins" | "jumps" | "rolls" | "laneChanges" | "powerUps" | "jetpacks" | "mysteryBoxes" | "hoverboards" | "score" | "distance";

export type MissionScope = "run" | "total";

interface MissionTemplate {
  id: string;
  metric: MissionMetric;
  scope: MissionScope;
  /** Target for set level 0 and the per-level growth. */
  base: number;
  perLevel: number;
  describe: (target: number) => string;
}

export interface Mission {
  templateId: string;
  metric: MissionMetric;
  scope: MissionScope;
  target: number;
  progress: number;
  done: boolean;
  description: string;
}

export interface MissionState {
  /** Completed sets; the score multiplier is 1 + level. */
  level: number;
  missions: Mission[];
}

export const MAX_MISSION_LEVEL = 29;
export const MISSIONS_PER_SET = 3;

const TEMPLATES: readonly MissionTemplate[] = [
  { id: "coinsRun", metric: "coins", scope: "run", base: 60, perLevel: 40, describe: (n) => `Collect ${n} coins in one run` },
  { id: "coinsTotal", metric: "coins", scope: "total", base: 250, perLevel: 150, describe: (n) => `Collect ${n} coins` },
  { id: "jumps", metric: "jumps", scope: "total", base: 15, perLevel: 10, describe: (n) => `Jump ${n} times` },
  { id: "rolls", metric: "rolls", scope: "total", base: 10, perLevel: 8, describe: (n) => `Roll ${n} times` },
  { id: "dodges", metric: "laneChanges", scope: "run", base: 25, perLevel: 12, describe: (n) => `Change lanes ${n} times in one run` },
  { id: "powerUps", metric: "powerUps", scope: "total", base: 3, perLevel: 2, describe: (n) => `Pick up ${n} power-ups` },
  { id: "jetpacks", metric: "jetpacks", scope: "total", base: 1, perLevel: 1, describe: (n) => `Fly with ${n} jetpack${n === 1 ? "" : "s"}` },
  { id: "mystery", metric: "mysteryBoxes", scope: "total", base: 1, perLevel: 1, describe: (n) => `Open ${n} mystery box${n === 1 ? "" : "es"}` },
  { id: "boards", metric: "hoverboards", scope: "total", base: 1, perLevel: 1, describe: (n) => `Use ${n} hoverboard${n === 1 ? "" : "s"}` },
  { id: "score", metric: "score", scope: "run", base: 2500, perLevel: 2000, describe: (n) => `Score ${n.toLocaleString("en-US")} points in one run` },
  { id: "distance", metric: "distance", scope: "run", base: 600, perLevel: 350, describe: (n) => `Run ${n.toLocaleString("en-US")} m in one run` },
];

const templateById = (id: string) => TEMPLATES.find((template) => template.id === id);

/** Deterministically picks three distinct missions for a set level. */
export const createMissionSet = (level: number): Mission[] => {
  const rng = new Random(level * 2654435761 + 97);
  const pool = rng.shuffle([...TEMPLATES]);
  const chosen: MissionTemplate[] = [];
  for (const template of pool) {
    // Keep a set varied: never two missions measuring the same thing.
    if (chosen.some((existing) => existing.metric === template.metric)) continue;
    chosen.push(template);
    if (chosen.length === MISSIONS_PER_SET) break;
  }
  return chosen.map((template) => {
    const target = Math.round(template.base + template.perLevel * level);
    return {
      templateId: template.id,
      metric: template.metric,
      scope: template.scope,
      target,
      progress: 0,
      done: false,
      description: template.describe(target),
    };
  });
};

export const initialMissionState = (): MissionState => ({ level: 0, missions: createMissionSet(0) });

export interface MissionUpdate {
  completed: Mission[];
  /** Set when all missions of a set were finished and the next level unlocked. */
  levelUp: { level: number; multiplier: number; reward: number } | null;
}

/**
 * Pure mission bookkeeping. Callers feed metric deltas (and run totals for
 * "in one run" missions); the tracker reports newly completed missions and
 * set completions.
 */
export class MissionTracker {
  private state: MissionState;

  constructor(state: MissionState) {
    this.state = structuredClone(state);
  }

  get snapshot(): MissionState {
    return structuredClone(this.state);
  }

  /** "In one run" missions restart from zero each run (unless already completed). */
  startRun(): void {
    for (const mission of this.state.missions) if (mission.scope === "run" && !mission.done) mission.progress = 0;
  }

  /**
   * @param metric - What happened
   * @param amount - Increment for cumulative counters
   * @param runValue - Current in-run total for this metric (used by "run" scoped missions)
   */
  record(metric: MissionMetric, amount: number, runValue: number): MissionUpdate {
    const completed: Mission[] = [];
    for (const mission of this.state.missions) {
      if (mission.done || mission.metric !== metric) continue;
      mission.progress = mission.scope === "run" ? Math.max(mission.progress, runValue) : mission.progress + amount;
      if (mission.progress >= mission.target) {
        mission.progress = mission.target;
        mission.done = true;
        completed.push({ ...mission });
      }
    }
    return { completed, levelUp: completed.length > 0 ? this.maybeLevelUp() : null };
  }

  private maybeLevelUp(): MissionUpdate["levelUp"] {
    if (!this.state.missions.every((mission) => mission.done)) return null;
    if (this.state.level >= MAX_MISSION_LEVEL) {
      // Max multiplier reached: keep issuing fresh sets for the coin reward.
      this.state.missions = createMissionSet(this.state.level);
      return { level: this.state.level, multiplier: 1 + this.state.level, reward: 1000 };
    }
    this.state.level += 1;
    this.state.missions = createMissionSet(this.state.level);
    return { level: this.state.level, multiplier: 1 + this.state.level, reward: 250 + this.state.level * 150 };
  }
}

/** Validates persisted mission data, regenerating anything unrecognisable. */
export const sanitizeMissionState = (raw: unknown, fallbackLevel: number): MissionState => {
  const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null;
  const level =
    isRecord(raw) && typeof raw.level === "number" && Number.isFinite(raw.level)
      ? Math.max(0, Math.min(MAX_MISSION_LEVEL, Math.floor(raw.level)))
      : fallbackLevel;
  const fresh = createMissionSet(level);
  if (!isRecord(raw) || !Array.isArray(raw.missions) || raw.missions.length !== MISSIONS_PER_SET) return { level, missions: fresh };
  const missions = raw.missions.map((entry, index): Mission => {
    const template = isRecord(entry) && typeof entry.templateId === "string" ? templateById(entry.templateId) : undefined;
    const expected = fresh[index]!;
    if (!template || !isRecord(entry) || typeof entry.target !== "number" || entry.target <= 0) return expected;
    const progress = typeof entry.progress === "number" && entry.progress >= 0 ? Math.min(entry.progress, entry.target) : 0;
    return {
      templateId: template.id,
      metric: template.metric,
      scope: template.scope,
      target: Math.round(entry.target),
      progress,
      done: entry.done === true || progress >= entry.target,
      description: template.describe(Math.round(entry.target)),
    };
  });
  return { level, missions };
};
