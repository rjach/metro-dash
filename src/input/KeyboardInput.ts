import type { GameAction } from "../game/actions";
import type { Emit, InputSource, UiCommand } from "./InputManager";

const ACTION_KEYS: Record<string, GameAction> = {
  ArrowLeft: "left",
  KeyA: "left",
  ArrowRight: "right",
  KeyD: "right",
  ArrowUp: "jump",
  KeyW: "jump",
  ArrowDown: "roll",
  KeyS: "roll",
  Space: "hoverboard",
};

const COMMAND_KEYS: Record<string, UiCommand> = {
  Escape: "pause",
  KeyP: "pause",
  Enter: "confirm",
  Backspace: "back",
  KeyC: "toggleInputMode",
  KeyH: "headstart",
};

/** Keyboard source: arrows/WASD to move, Space for the hoverboard, Esc/P to pause. */
export class KeyboardInput implements InputSource {
  readonly id = "keyboard" as const;
  private active = false;

  constructor(
    private readonly emit: Emit,
    private readonly target: Window = window,
  ) {}

  get enabled(): boolean {
    return this.active;
  }

  enable(): void {
    if (this.active) return;
    this.active = true;
    this.target.addEventListener("keydown", this.onKeyDown);
  }

  disable(): void {
    this.active = false;
    this.target.removeEventListener("keydown", this.onKeyDown);
  }

  private readonly onKeyDown = (event: KeyboardEvent): void => {
    // Holding a key must not machine-gun lane changes.
    if (event.repeat) return;
    const element = event.target as HTMLElement | null;
    const typing = element && (element.tagName === "INPUT" || element.tagName === "SELECT" || element.tagName === "TEXTAREA");
    const action = ACTION_KEYS[event.code];
    if (action && !typing) {
      if (event.code.startsWith("Arrow") || event.code === "Space") event.preventDefault();
      this.emit("action", { action, source: "keyboard" });
    }
    const command = COMMAND_KEYS[event.code];
    // A focused button already activates on Enter; emitting "confirm" too would run the action twice.
    const onButton = element?.tagName === "BUTTON" || element?.tagName === "A";
    if (command && !typing && !(command === "confirm" && onButton)) this.emit("command", { command, source: "keyboard" });
  };
}
