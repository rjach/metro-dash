import { EventBus } from "../core/EventBus";
import { createDefaultSave, sanitizeSave, type SaveData } from "./SaveData";

/** Abstraction over localStorage so persistence is testable and failure-tolerant. */
export interface KeyValueStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export const STORAGE_KEY = "metro-dash:save";

export class MemoryStore implements KeyValueStore {
  private readonly data = new Map<string, string>();
  getItem(key: string): string | null {
    return this.data.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    this.data.set(key, value);
  }
  removeItem(key: string): void {
    this.data.delete(key);
  }
}

/** Returns localStorage when usable (it throws in some privacy modes), else an in-memory store. */
export const resolveBrowserStore = (): KeyValueStore => {
  try {
    const probe = "metro-dash:probe";
    window.localStorage.setItem(probe, "1");
    window.localStorage.removeItem(probe);
    return window.localStorage;
  } catch {
    return new MemoryStore();
  }
};

interface SaveEvents {
  change: SaveData;
}

/**
 * Owns the player's persistent profile. All mutations go through `update` so
 * every change is validated, persisted immediately and broadcast to the UI.
 */
export class SaveStore {
  readonly events = new EventBus<SaveEvents>();
  private current: SaveData;
  private writeFailed = false;

  constructor(private readonly store: KeyValueStore) {
    this.current = this.load();
  }

  get data(): Readonly<SaveData> {
    return this.current;
  }

  get persistenceAvailable(): boolean {
    return !this.writeFailed;
  }

  update(mutator: (draft: SaveData) => void): SaveData {
    const draft = structuredClone(this.current);
    mutator(draft);
    this.current = sanitizeSave(draft);
    this.persist();
    this.events.emit("change", this.current);
    return this.current;
  }

  reset(): void {
    const keepSettings = this.current.settings;
    this.current = { ...createDefaultSave(), settings: keepSettings };
    this.persist();
    this.events.emit("change", this.current);
  }

  private load(): SaveData {
    try {
      const raw = this.store.getItem(STORAGE_KEY);
      return raw ? sanitizeSave(JSON.parse(raw)) : createDefaultSave();
    } catch {
      return createDefaultSave();
    }
  }

  private persist(): void {
    try {
      this.store.setItem(STORAGE_KEY, JSON.stringify(this.current));
      this.writeFailed = false;
    } catch {
      // Quota exceeded or storage disabled: keep playing with in-memory progress.
      this.writeFailed = true;
    }
  }
}
