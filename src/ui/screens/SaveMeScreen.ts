import { REVIVE } from "../../core/config";
import { h } from "../dom";
import { icon } from "../icons";
import { Screen } from "../Screen";
import type { UiController } from "../controller";

const RING_RADIUS = 44;
const RING_LENGTH = 2 * Math.PI * RING_RADIUS;

/** "Save me!" offer after a crash: spend keys to continue before the ring runs out. */
export class SaveMeScreen extends Screen {
  private remaining = 0;
  private readonly ring: SVGCircleElement;
  private readonly costLabel = h("span", {}, "1");
  private readonly keysLabel = h("div", { class: "muted" });
  private readonly saveButton: HTMLButtonElement;

  constructor(ui: UiController) {
    super(ui, "save-me-screen dim");
    const ns = "http://www.w3.org/2000/svg";
    const svg = document.createElementNS(ns, "svg");
    svg.setAttribute("viewBox", "0 0 100 100");
    svg.classList.add("ring");
    const track = document.createElementNS(ns, "circle");
    track.setAttribute("cx", "50");
    track.setAttribute("cy", "50");
    track.setAttribute("r", String(RING_RADIUS));
    track.setAttribute("fill", "rgba(0,0,0,0.35)");
    track.setAttribute("stroke", "rgba(255,255,255,0.25)");
    track.setAttribute("stroke-width", "8");
    this.ring = document.createElementNS(ns, "circle");
    this.ring.setAttribute("cx", "50");
    this.ring.setAttribute("cy", "50");
    this.ring.setAttribute("r", String(RING_RADIUS));
    this.ring.setAttribute("fill", "none");
    this.ring.setAttribute("stroke", "#ffd23f");
    this.ring.setAttribute("stroke-width", "8");
    this.ring.setAttribute("stroke-linecap", "round");
    this.ring.setAttribute("stroke-dasharray", String(RING_LENGTH));
    svg.append(track, this.ring);

    this.saveButton = this.button("", "green big", () => ui.revive(), { "data-autofocus": "true" });
    this.saveButton.append(h("span", {}, "Save me!"), h("span", { html: icon("key") }), this.costLabel);
    this.root.append(
      h(
        "div",
        { class: "center-stack save-me pop-in" },
        h("div", { class: "display title" }, "Save me?"),
        h("div", { class: "timer-ring" }, svg, h("div", { class: "key-icon", html: icon("key") })),
        this.saveButton,
        this.keysLabel,
        this.button("No thanks", "", () => ui.skipRevive()),
      ),
    );
  }

  offer(cost: number): void {
    this.remaining = REVIVE.offerSeconds;
    this.costLabel.textContent = String(cost);
    const keys = this.ui.save.data.keys;
    this.keysLabel.textContent = `You have ${keys} key${keys === 1 ? "" : "s"}`;
    this.saveButton.disabled = keys < cost;
  }

  override update(dt: number): void {
    if (this.remaining <= 0) return;
    this.remaining -= dt;
    const fraction = Math.max(0, this.remaining / REVIVE.offerSeconds);
    this.ring.setAttribute("stroke-dashoffset", String(RING_LENGTH * (1 - fraction)));
    if (this.remaining <= 0) this.ui.skipRevive();
  }
}
