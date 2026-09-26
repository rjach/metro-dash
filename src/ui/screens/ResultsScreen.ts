import { formatNumber, h } from "../dom";
import { icon } from "../icons";
import type { MissionState } from "../../game/missions";
import { MissionsPanel } from "../MissionsPanel";
import { Screen } from "../Screen";
import type { UiController } from "../controller";

export interface RunSummary {
  score: number;
  coins: number;
  distance: number;
  highScore: number;
  newRecord: boolean;
  keys: number;
  totalCoins: number;
  missions: MissionState;
}

export class ResultsScreen extends Screen {
  private readonly scoreValue = h("div", { class: "big-score display" }, "0");
  private readonly ribbonSlot = h("div", { style: "text-align:center; min-height:2.2em" });
  private readonly lines = h("div");
  private readonly missions = new MissionsPanel();
  private animation = 0;
  private target = 0;
  private displayedScore = 0;

  constructor(ui: UiController) {
    super(ui, "results-screen dim");
    this.root.append(
      h(
        "div",
        { class: "center-stack" },
        h(
          "div",
          { class: "panel results slide-up", style: "padding-top: 2em" },
          h("div", { class: "panel-title display" }, "Score"),
          this.scoreValue,
          this.ribbonSlot,
          this.lines,
        ),
        this.missions.root,
        h(
          "div",
          { class: "row slide-up" },
          this.button(icon("home"), "icon", () => ui.quitToMenu(), { "aria-label": "Home" }),
          this.button(`${icon("play")}Play`, "green big", () => ui.restartRun(), { "data-autofocus": "true" }),
          this.button(icon("shop"), "icon yellow", () => ui.open("shop"), { "aria-label": "Shop" }),
        ),
      ),
    );
  }

  present(summary: RunSummary): void {
    this.target = summary.score;
    this.displayedScore = 0;
    this.animation = 0;
    this.scoreValue.textContent = "0";
    this.ribbonSlot.replaceChildren(
      summary.newRecord ? h("span", { class: "ribbon" }, "NEW HIGH SCORE!") : h("span", { class: "muted" }, `Best ${formatNumber(summary.highScore)}`),
    );
    const line = (label: string, value: string, iconName?: Parameters<typeof icon>[0]) =>
      h("div", { class: "line" }, h("span", {}, label), h("span", { class: "value", html: iconName ? icon(iconName) : "" }, value));
    this.lines.replaceChildren(
      line("Coins", `+${formatNumber(summary.coins)}`, "coin"),
      line("Distance", `${formatNumber(summary.distance)} m`),
      ...(summary.keys > 0 ? [line("Keys found", `+${summary.keys}`, "key")] : []),
      line("Bank", formatNumber(summary.totalCoins), "coin"),
    );
    this.missions.render(summary.missions);
  }

  override update(dt: number): void {
    if (this.displayedScore >= this.target) return;
    this.animation = Math.min(1, this.animation + dt / 1.1);
    const eased = 1 - (1 - this.animation) ** 3;
    this.displayedScore = this.animation >= 1 ? this.target : this.target * eased;
    this.scoreValue.textContent = formatNumber(this.displayedScore);
  }
}
