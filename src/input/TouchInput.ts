import type { Emit, InputSource } from "./InputManager";

const SWIPE_MIN_DISTANCE = 28;
const DOUBLE_TAP_MS = 280;

/** Swipe controls for touch screens; a double tap activates the hoverboard. */
export class TouchInput implements InputSource {
  readonly id = "touch" as const;
  private active = false;
  private start: { x: number; y: number; id: number; fired: boolean } | null = null;
  private lastTap = 0;

  constructor(
    private readonly emit: Emit,
    private readonly surface: HTMLElement,
  ) {}

  get enabled(): boolean {
    return this.active;
  }

  enable(): void {
    if (this.active) return;
    this.active = true;
    this.surface.addEventListener("pointerdown", this.onDown);
    this.surface.addEventListener("pointermove", this.onMove);
    this.surface.addEventListener("pointerup", this.onUp);
    this.surface.addEventListener("pointercancel", this.onUp);
  }

  disable(): void {
    this.active = false;
    this.surface.removeEventListener("pointerdown", this.onDown);
    this.surface.removeEventListener("pointermove", this.onMove);
    this.surface.removeEventListener("pointerup", this.onUp);
    this.surface.removeEventListener("pointercancel", this.onUp);
  }

  private readonly onDown = (event: PointerEvent): void => {
    if (event.pointerType === "mouse" && event.button !== 0) return;
    this.start = { x: event.clientX, y: event.clientY, id: event.pointerId, fired: false };
  };

  /** Fires as soon as the swipe is long enough, which feels much snappier than waiting for release. */
  private readonly onMove = (event: PointerEvent): void => {
    const start = this.start;
    if (!start || start.fired || start.id !== event.pointerId) return;
    const dx = event.clientX - start.x;
    const dy = event.clientY - start.y;
    if (Math.max(Math.abs(dx), Math.abs(dy)) < SWIPE_MIN_DISTANCE) return;
    start.fired = true;
    const action = Math.abs(dx) > Math.abs(dy) ? (dx < 0 ? "left" : "right") : dy < 0 ? "jump" : "roll";
    this.emit("action", { action, source: "touch" });
  };

  private readonly onUp = (event: PointerEvent): void => {
    const start = this.start;
    this.start = null;
    if (!start || start.fired || start.id !== event.pointerId) return;
    const now = performance.now();
    if (now - this.lastTap < DOUBLE_TAP_MS) {
      this.emit("action", { action: "hoverboard", source: "touch" });
      this.lastTap = 0;
    } else {
      this.lastTap = now;
    }
  };
}
