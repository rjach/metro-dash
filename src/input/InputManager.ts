import { EventBus } from "../core/EventBus";
import type { GameAction } from "../game/actions";

export type InputSourceId = "keyboard" | "touch" | "camera";

/** Non-gameplay commands (menus, pause) that devices may also produce. */
export type UiCommand = "pause" | "confirm" | "back" | "toggleInputMode" | "headstart";

export interface InputEvents {
  action: { action: GameAction; source: InputSourceId };
  command: { command: UiCommand; source: InputSourceId };
}

/** Anything that can translate a physical device into GameActions. */
export interface InputSource {
  readonly id: InputSourceId;
  /** Starts listening/processing. May be async (e.g. camera permission). */
  enable(): void | Promise<void>;
  disable(): void;
  readonly enabled: boolean;
}

export type Emit = <K extends keyof InputEvents>(event: K, payload: InputEvents[K]) => void;

/**
 * Unified input abstraction. Every device funnels into the same `action`
 * stream, so the game reacts identically to a key press, a swipe or a lean
 * detected by the camera.
 */
export class InputManager {
  readonly events = new EventBus<InputEvents>();
  private readonly sources = new Map<InputSourceId, InputSource>();
  private lastSource: InputSourceId = "keyboard";

  /** Bound emitter handed to sources so they never depend on the manager's internals. */
  readonly emit: Emit = (event, payload) => {
    this.lastSource = payload.source;
    this.events.emit(event, payload);
  };

  register(source: InputSource): void {
    this.sources.set(source.id, source);
  }

  get<T extends InputSource>(id: InputSourceId): T | undefined {
    return this.sources.get(id) as T | undefined;
  }

  get mostRecentSource(): InputSourceId {
    return this.lastSource;
  }

  disableAll(): void {
    for (const source of this.sources.values()) source.disable();
  }
}
