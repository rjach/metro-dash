import { h } from "./dom";
import type { UiController } from "./controller";

/** Base class for full-screen UI layers. */
export abstract class Screen {
  readonly root: HTMLElement;
  private shown = false;

  constructor(
    protected readonly ui: UiController,
    className: string,
  ) {
    this.root = h("section", { class: `screen ${className}`, "aria-hidden": "true" });
    this.root.inert = true;
  }

  get visible(): boolean {
    return this.shown;
  }

  show(): void {
    if (this.shown) return;
    this.shown = true;
    this.root.classList.add("visible");
    this.root.setAttribute("aria-hidden", "false");
    this.root.inert = false;
    this.onShow();
    // Move keyboard focus into the screen for accessibility, without scrolling.
    const focusTarget = this.root.querySelector<HTMLElement>("[data-autofocus]");
    focusTarget?.focus({ preventScroll: true });
  }

  hide(): void {
    if (!this.shown) return;
    this.shown = false;
    this.root.classList.remove("visible");
    this.root.setAttribute("aria-hidden", "true");
    // Inert removes the fading-out screen from focus order and the accessibility tree.
    this.root.inert = true;
    this.onHide();
  }

  /** Called every animation frame while visible. */
  update(_dt: number): void {}

  protected onShow(): void {}
  protected onHide(): void {}

  protected button(label: string | Node, className: string, onClick: () => void, extra: Record<string, string> = {}): HTMLButtonElement {
    const button = h("button", { class: `btn ${className}`, type: "button", ...extra });
    if (typeof label === "string") button.innerHTML = label;
    else button.append(label);
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      this.ui.sfx("click");
      onClick();
    });
    return button;
  }
}
