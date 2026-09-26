import { h } from "../ui/dom";
import type { ScreenId } from "../ui/controller";
import type { Screen } from "../ui/Screen";

/** Overlays keep the in-game HUD visible underneath them. */
const OVERLAYS_ON_HUD = new Set<ScreenId>(["pause", "saveMe"]);

/**
 * Screen stack: `open` pushes, `back` pops, `reset` jumps to a root screen.
 * Exactly one screen is interactive at a time; the HUD may stay visible
 * beneath pause-style overlays.
 */
export class UIManager {
  readonly layer = h("div", { class: "ui-layer" });
  private readonly screens = new Map<ScreenId, Screen>();
  private stack: ScreenId[] = [];

  register(id: ScreenId, screen: Screen): void {
    this.screens.set(id, screen);
    this.layer.append(screen.root);
  }

  get<T extends Screen>(id: ScreenId): T {
    const screen = this.screens.get(id);
    if (!screen) throw new Error(`Screen "${id}" is not registered`);
    return screen as T;
  }

  get current(): ScreenId | undefined {
    return this.stack[this.stack.length - 1];
  }

  has(id: ScreenId): boolean {
    return this.stack.includes(id);
  }

  reset(id: ScreenId): void {
    this.stack = [id];
    this.sync();
  }

  open(id: ScreenId): void {
    if (this.current === id) return;
    this.stack = this.stack.filter((entry) => entry !== id);
    this.stack.push(id);
    this.sync();
  }

  back(): ScreenId | undefined {
    if (this.stack.length > 1) this.stack.pop();
    this.sync();
    return this.current;
  }

  /** Removes a screen wherever it is in the stack. */
  close(id: ScreenId): void {
    this.stack = this.stack.filter((entry) => entry !== id);
    this.sync();
  }

  update(dt: number): void {
    for (const screen of this.screens.values()) if (screen.visible) screen.update(dt);
  }

  private sync(): void {
    const top = this.current;
    const visible = new Set<ScreenId>();
    if (top) visible.add(top);
    if (top && OVERLAYS_ON_HUD.has(top) && this.stack.includes("hud")) visible.add("hud");
    if (top === "settings" && this.stack.includes("pause")) visible.add("hud");
    for (const [id, screen] of this.screens) {
      if (visible.has(id)) screen.show();
      else screen.hide();
    }
  }
}
