import { describe, expect, it } from "vitest";
import { createDefaultSave, sanitizeSave } from "../src/persistence/SaveData";
import { MemoryStore, SaveStore, STORAGE_KEY, type KeyValueStore } from "../src/persistence/SaveStore";

describe("save data validation", () => {
  it("returns defaults for missing or garbage data", () => {
    expect(sanitizeSave(undefined)).toEqual(createDefaultSave());
    expect(sanitizeSave("nope")).toEqual(createDefaultSave());
    expect(sanitizeSave([1, 2, 3])).toEqual(createDefaultSave());
  });

  it("keeps valid progress and repairs invalid fields individually", () => {
    const repaired = sanitizeSave({
      highScore: 12345.7,
      coins: -50,
      keys: "lots",
      ownedCharacters: ["nova", "not-a-character", 42],
      selectedCharacter: "nova",
      selectedBoard: "inferno",
      upgrades: { magnet: 3, jetpack: 99, sneakers: -1 },
      settings: { musicVolume: 3, inputMode: "telepathy", cameraSensitivity: 1.2, graphicsQuality: "medium" },
    });
    expect(repaired.highScore).toBe(12345);
    expect(repaired.coins).toBe(0);
    expect(repaired.keys).toBe(createDefaultSave().keys);
    expect(repaired.ownedCharacters).toEqual(["jett", "nova"]);
    expect(repaired.selectedCharacter).toBe("nova");
    // Not owned, so selection falls back to the default board.
    expect(repaired.selectedBoard).toBe("starter");
    expect(repaired.upgrades).toEqual({ magnet: 3, jetpack: 5, sneakers: 0, multiplier: 0 });
    expect(repaired.settings.musicVolume).toBe(1);
    expect(repaired.settings.inputMode).toBe("keyboard");
    expect(repaired.settings.cameraSensitivity).toBe(1.2);
    expect(repaired.settings.graphicsQuality).toBe("medium");
  });

  it("drops incomplete calibration profiles", () => {
    expect(sanitizeSave({ calibration: { centerX: 0.5 } }).calibration).toBeNull();
    const profile = { centerX: 0.5, shoulderY: 0.3, hipY: 0.6, shoulderWidth: 0.2, torsoLength: 0.3, capturedAt: 1 };
    // Profiles saved before hand gestures existed gain relaxed-hand defaults.
    expect(sanitizeSave({ calibration: profile }).calibration).toEqual({ ...profile, leftHandRest: 0, rightHandRest: 0 });
  });
});

describe("SaveStore", () => {
  it("persists updates and reloads them (refresh persistence)", () => {
    const backing = new MemoryStore();
    const first = new SaveStore(backing);
    first.update((draft) => {
      draft.highScore = 999;
      draft.coins = 321;
      draft.ownedBoards.push("hopper");
      draft.selectedBoard = "hopper";
      draft.settings.inputMode = "camera";
    });
    const reloaded = new SaveStore(backing);
    expect(reloaded.data.highScore).toBe(999);
    expect(reloaded.data.coins).toBe(321);
    expect(reloaded.data.selectedBoard).toBe("hopper");
    expect(reloaded.data.settings.inputMode).toBe("camera");
  });

  it("recovers from corrupted JSON", () => {
    const backing = new MemoryStore();
    backing.setItem(STORAGE_KEY, "{not json");
    expect(new SaveStore(backing).data).toEqual(createDefaultSave());
  });

  it("keeps playing in memory when storage writes fail", () => {
    const failing: KeyValueStore = {
      getItem: () => null,
      setItem: () => {
        throw new Error("QuotaExceededError");
      },
      removeItem: () => undefined,
    };
    const store = new SaveStore(failing);
    store.update((draft) => {
      draft.coins = 50;
    });
    expect(store.data.coins).toBe(50);
    expect(store.persistenceAvailable).toBe(false);
  });

  it("emits change events and reset keeps settings", () => {
    const store = new SaveStore(new MemoryStore());
    let changes = 0;
    store.events.on("change", () => changes++);
    store.update((draft) => {
      draft.coins = 10;
      draft.settings.musicVolume = 0.2;
    });
    store.reset();
    expect(changes).toBe(2);
    expect(store.data.coins).toBe(0);
    expect(store.data.settings.musicVolume).toBe(0.2);
  });
});
