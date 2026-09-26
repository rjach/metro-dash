import type { GameAction } from "../../game/actions";
import type { ActivePowerUp, TimedPowerUp } from "../../game/types";
import { POWER_UPS } from "../../content/powerups";
import type { InputMode } from "../../persistence/SaveData";
import { CameraPreview } from "../CameraPreview";
import { formatNumber, h, padScore } from "../dom";
import { icon, type IconName } from "../icons";
import { Screen } from "../Screen";
import type { UiController } from "../controller";

export interface HudState {
  score: number;
  coins: number;
  multiplier: number;
  multiplierBoosted: boolean;
  powerUps: readonly ActivePowerUp[];
  hoverboards: number;
  hoverboardActive: boolean;
  hoverboardFraction: number;
  /** Seconds left to trigger a headstart, or 0 when it cannot be used. */
  headstartWindow: number;
  headstarts: number;
}

const POWER_UP_ICONS: Record<TimedPowerUp, IconName> = {
  magnet: "magnet",
  jetpack: "jetpack",
  sneakers: "sneakers",
  multiplier: "multiplier",
};

const GESTURE_ICONS: Record<GameAction, IconName> = {
  left: "arrowLeft",
  right: "arrowRight",
  jump: "jump",
  roll: "crouch",
  hoverboard: "hands",
};

/** In-run heads-up display, laid out like the genre standard: score top-right, pause top-left. */
export class HudScreen extends Screen {
  private readonly score = h("div", { class: "score", "aria-live": "off" }, "000000");
  private readonly multiplier = h("div", { class: "multiplier", title: "Score multiplier" }, "x1");
  private readonly coinValue = h("span", { class: "value" }, "0");
  private readonly coinRow: HTMLElement;
  private readonly powerUpList = h("div", { class: "powerups" });
  private readonly powerUpRows = new Map<TimedPowerUp, { row: HTMLElement; fill: HTMLElement }>();
  private readonly boardButton: HTMLButtonElement;
  private readonly boardCount = h("span", { class: "badge" }, "0");
  private readonly boardTimer = h("div", { class: "board-timer" }, h("div"));
  private readonly headstartButton: HTMLButtonElement;
  private readonly headstartCount = h("span", { class: "badge" }, "0");
  private readonly toastStack = h("div", { class: "toast-stack", role: "status", "aria-live": "polite" });
  private readonly countdownLayer = h("div", { class: "countdown display", "aria-live": "assertive" });
  private readonly tutorialLayer = h("div", { class: "tutorial" });
  private readonly trackingAlert = h("div", { class: "tracking-alert" });
  private readonly pip: CameraPreview;
  private readonly pipWrap: HTMLElement;
  private readonly pipStatus = h("div", { class: "status-dot" }, h("span", { class: "dot" }), h("span", {}, "Camera"));
  private readonly gestureFlash = h("div", { class: "gesture-flash" });
  private lastCoins = 0;
  private lastScoreText = "";
  private tutorialTimer = 0;

  constructor(ui: UiController) {
    super(ui, "hud-screen passthrough");
    // HUD buttons must not keep focus: Space (hoverboard) would otherwise re-press them.
    this.root.addEventListener("click", (event) => {
      if (event.target instanceof Element) (event.target.closest("button") as HTMLButtonElement | null)?.blur();
    });
    const pause = this.button(icon("pause"), "icon interactive", () => ui.pause(), { "aria-label": "Pause (Esc)" });
    this.coinRow = h("div", { class: "pill coin-row", html: icon("coin") }, this.coinValue);
    this.boardButton = this.button(`${icon("board")}<span class="hint">SPACE</span>`, "board-button interactive", () => ui.activateHoverboard(), {
      "aria-label": "Activate hoverboard (Space)",
    });
    this.boardButton.append(this.boardCount, this.boardTimer);
    this.headstartButton = this.button(
      `${icon("rocket")}<span class="hint">HEADSTART · H</span>`,
      "board-button yellow interactive pop-in",
      () => ui.useHeadstart(),
      {
        "aria-label": "Use a headstart (H)",
      },
    );
    this.headstartButton.append(this.headstartCount);
    this.headstartButton.hidden = true;

    this.pip = new CameraPreview(ui.camera, "cam-pip", [320, 240]);
    this.pip.root.append(this.pipStatus, this.gestureFlash);
    this.pipWrap = this.pip.root;
    this.pipWrap.hidden = true;

    this.trackingAlert.hidden = true;
    this.root.append(
      h("div", { class: "hud-top" }, pause, h("div", { class: "hud-score" }, h("div", { class: "score-row" }, this.multiplier, this.score), this.coinRow)),
      h("div", { class: "hud-bottom" }, this.powerUpList, h("div", { class: "hud-right" }, this.pipWrap, this.headstartButton, this.boardButton)),
      this.toastStack,
      this.countdownLayer,
      this.tutorialLayer,
      this.trackingAlert,
    );

    ui.camera.events.on("tracking", ({ tracking }) => {
      const dot = this.pipStatus.querySelector(".dot")!;
      dot.className = `dot ${tracking ? "ok" : "warn"}`;
      this.pipStatus.lastElementChild!.textContent = tracking ? "Tracking" : "Find me!";
    });
    ui.camera.events.on("gesture", ({ action }) => this.flashGesture(action as GameAction));
  }

  setCameraMode(mode: InputMode, showPreview: boolean): void {
    const visible = mode === "camera" && showPreview;
    this.pipWrap.hidden = !visible;
    if (visible && this.visible) this.pip.start();
    else this.pip.stop();
  }

  render(state: HudState): void {
    const scoreText = padScore(state.score);
    if (scoreText !== this.lastScoreText) {
      this.score.textContent = scoreText;
      this.lastScoreText = scoreText;
    }
    this.multiplier.textContent = `x${state.multiplier}`;
    this.multiplier.classList.toggle("boosted", state.multiplierBoosted);
    if (state.coins !== this.lastCoins) {
      this.coinValue.textContent = formatNumber(state.coins);
      this.coinRow.classList.remove("bump");
      void this.coinRow.offsetWidth;
      this.coinRow.classList.add("bump");
      this.lastCoins = state.coins;
    }
    this.renderPowerUps(state.powerUps);
    this.boardCount.textContent = String(state.hoverboards);
    this.boardButton.disabled = !state.hoverboardActive && state.hoverboards <= 0;
    this.boardButton.classList.toggle("green", state.hoverboardActive);
    this.headstartButton.hidden = state.headstartWindow <= 0 || state.headstarts <= 0;
    this.headstartCount.textContent = String(state.headstarts);
    const timer = this.boardTimer.firstElementChild as HTMLElement;
    this.boardTimer.hidden = !state.hoverboardActive;
    timer.style.transform = `scaleX(${state.hoverboardFraction})`;
  }

  override update(dt: number): void {
    if (this.tutorialTimer > 0) {
      this.tutorialTimer -= dt;
      if (this.tutorialTimer <= 0) this.tutorialLayer.replaceChildren();
    }
  }

  toast(text: string, kind: "big" | "info" | "warn" = "big"): void {
    const toast = h("div", { class: `toast ${kind === "big" ? "" : kind}` }, text);
    this.toastStack.append(toast);
    while (this.toastStack.childElementCount > 3) this.toastStack.firstElementChild?.remove();
    setTimeout(() => toast.remove(), 2400);
  }

  showCountdown(value: number | "GO!"): void {
    this.countdownLayer.replaceChildren(h("span", {}, String(value)));
  }

  clearCountdown(): void {
    this.countdownLayer.replaceChildren();
  }

  hideTutorial(): void {
    this.tutorialTimer = 0;
    this.tutorialLayer.replaceChildren();
  }

  showTutorial(mode: InputMode): void {
    const step = (label: string, key: string) => h("div", { class: "step" }, h("span", { class: "keycap" }, key), h("span", {}, label));
    const steps =
      mode === "camera"
        ? [step("Raise a hand", "← →"), step("Jump", "JUMP"), step("Crouch to slide", "SQUAT"), step("Both hands up", "BOARD")]
        : [step("Change lane", "← →"), step("Jump", "↑"), step("Roll", "↓"), step("Hoverboard", "SPACE")];
    this.tutorialLayer.replaceChildren(...steps);
    this.tutorialTimer = 7;
  }

  setTrackingAlert(message: string | null): void {
    this.trackingAlert.hidden = message === null;
    if (message === null) return;
    this.trackingAlert.replaceChildren(
      h(
        "div",
        { class: "panel pop-in center-stack", style: "max-width: 24em; padding-top: 1.2em", role: "alert" },
        h("div", { style: "width:3.2em", html: icon("camera") }),
        h("div", { class: "display subtitle" }, "Can't see you!"),
        h("div", { class: "cam-tip", style: "text-align:center" }, message),
      ),
    );
  }

  protected override onShow(): void {
    if (!this.pipWrap.hidden) this.pip.start();
  }

  protected override onHide(): void {
    this.pip.stop();
    this.clearCountdown();
  }

  private flashGesture(action: GameAction): void {
    if (this.pipWrap.hidden) return;
    this.gestureFlash.innerHTML = icon(GESTURE_ICONS[action]);
  }

  private renderPowerUps(powerUps: readonly ActivePowerUp[]): void {
    const active = new Set<TimedPowerUp>();
    for (const powerUp of powerUps) {
      active.add(powerUp.kind);
      let entry = this.powerUpRows.get(powerUp.kind);
      if (!entry) {
        const fill = h("div");
        const def = POWER_UPS[powerUp.kind];
        const row = h(
          "div",
          { class: "powerup", title: def.name },
          h("div", { class: "icon", style: `background:${def.color}`, html: icon(POWER_UP_ICONS[powerUp.kind]) }),
          h("div", { class: "bar" }, fill),
        );
        this.powerUpList.append(row);
        entry = { row, fill };
        this.powerUpRows.set(powerUp.kind, entry);
      }
      const fraction = Math.max(0, powerUp.remaining / powerUp.duration);
      entry.fill.style.transform = `scaleX(${fraction})`;
      entry.row.classList.toggle("expiring", powerUp.remaining < 2);
    }
    for (const [kind, entry] of this.powerUpRows) {
      if (active.has(kind)) continue;
      entry.row.remove();
      this.powerUpRows.delete(kind);
    }
  }
}
