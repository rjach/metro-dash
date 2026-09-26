import { describe, expect, it } from "vitest";
import { createMissionSet, initialMissionState, MissionTracker, sanitizeMissionState } from "../src/game/missions";
import { sanitizeSave } from "../src/persistence/SaveData";

describe("missions", () => {
  it("creates three distinct, deterministic missions per level", () => {
    for (let level = 0; level < 30; level++) {
      const set = createMissionSet(level);
      expect(set).toHaveLength(3);
      expect(new Set(set.map((m) => m.metric)).size).toBe(3);
      expect(createMissionSet(level)).toEqual(set);
    }
  });

  it("targets grow with the set level", () => {
    const sum = (level: number) => createMissionSet(level).reduce((total, m) => total + m.target, 0);
    expect(createMissionSet(10).every((m) => m.target > 0)).toBe(true);
    expect(sum(20)).toBeGreaterThan(0);
  });

  it("tracks cumulative and in-one-run missions differently", () => {
    const state = initialMissionState();
    state.missions = [
      { templateId: "jumps", metric: "jumps", scope: "total", target: 5, progress: 3, done: false, description: "" },
      { templateId: "coinsRun", metric: "coins", scope: "run", target: 10, progress: 7, done: false, description: "" },
      { templateId: "rolls", metric: "rolls", scope: "total", target: 2, progress: 0, done: false, description: "" },
    ];
    const tracker = new MissionTracker(state);
    tracker.startRun();
    expect(tracker.snapshot.missions[1]!.progress).toBe(0);
    expect(tracker.record("jumps", 1, 1).completed).toHaveLength(0);
    const jumpDone = tracker.record("jumps", 1, 2);
    expect(jumpDone.completed.map((m) => m.metric)).toEqual(["jumps"]);
    expect(tracker.record("coins", 1, 9).completed).toHaveLength(0);
    expect(tracker.record("coins", 1, 10).completed.map((m) => m.metric)).toEqual(["coins"]);
  });

  it("completing a set raises the multiplier and deals a fresh set", () => {
    const state = initialMissionState();
    state.missions = state.missions.map((m) => ({ ...m, target: 1 }));
    const tracker = new MissionTracker(state);
    let levelUp = null;
    for (const mission of state.missions) {
      const update = tracker.record(mission.metric, 1, 1);
      levelUp = update.levelUp ?? levelUp;
    }
    expect(levelUp).toMatchObject({ level: 1, multiplier: 2 });
    expect(tracker.snapshot.level).toBe(1);
    expect(tracker.snapshot.missions.every((m) => !m.done && m.progress === 0)).toBe(true);
  });

  it("validates persisted missions and migrates the legacy multiplier level", () => {
    expect(sanitizeMissionState(null, 4).level).toBe(4);
    const tampered = sanitizeMissionState({ level: 2, missions: [{ templateId: "hack", target: -5 }, {}, {}] }, 0);
    expect(tampered.missions).toEqual(createMissionSet(2));
    const legacy = sanitizeSave({ scoreMultiplierLevel: 3 });
    expect(legacy.missions.level).toBe(3);
  });
});
