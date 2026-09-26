import type { SaveData } from "../../persistence/SaveData";
import { formatNumber, h } from "../dom";
import { icon } from "../icons";
import { MissionsPanel } from "../MissionsPanel";
import { Screen } from "../Screen";
import type { UiController } from "../controller";

export const currencyBar = (): { root: HTMLElement; update: (save: SaveData) => void } => {
  const coins = h("span", { class: "value" }, "0");
  const keys = h("span", { class: "value" }, "0");
  const boards = h("span", { class: "value" }, "0");
  const root = h(
    "div",
    { class: "currency-bar" },
    h("div", { class: "pill", title: "Coins", html: icon("coin") }, coins),
    h("div", { class: "pill", title: "Keys", html: icon("key") }, keys),
    h("div", { class: "pill", title: "Hoverboards", html: icon("board") }, boards),
  );
  return {
    root,
    update: (save) => {
      coins.textContent = formatNumber(save.coins);
      keys.textContent = formatNumber(save.keys);
      boards.textContent = formatNumber(save.hoverboards);
    },
  };
};

/** Title screen: the runner idles on the tracks behind the UI, "Tap to play" starts a run. */
export class MainMenuScreen extends Screen {
  private readonly topRun = h("div", { class: "value display" }, "0");
  private readonly multiplierChip = h("div", { class: "stat-chip" }, "x1");
  private readonly currency = currencyBar();
  private readonly keyboardMode: HTMLButtonElement;
  private readonly cameraMode: HTMLButtonElement;
  private readonly missions = new MissionsPanel();

  constructor(ui: UiController) {
    super(ui, "menu-screen");
    this.keyboardMode = h("button", { type: "button", html: `${icon("keyboard")}<span>Keyboard</span>`, "aria-pressed": "true" });
    this.cameraMode = h("button", { type: "button", html: `${icon("camera")}<span>Camera</span>`, "aria-pressed": "false" });
    this.keyboardMode.addEventListener("click", () => {
      ui.sfx("click");
      ui.setInputMode("keyboard");
    });
    this.cameraMode.addEventListener("click", () => {
      ui.sfx("click");
      ui.setInputMode("camera");
    });

    const playButton = h("button", { class: "tap-to-play display", type: "button", "data-autofocus": "true", "aria-label": "Tap to play" }, "TAP TO PLAY");
    playButton.addEventListener("click", () => ui.play());
    const sceneArea = h("div", { class: "menu-spacer", "aria-hidden": "true" });
    sceneArea.addEventListener("click", () => ui.play());

    const tile = (label: string, iconName: Parameters<typeof icon>[0], action: () => void, colour = "") => {
      const button = this.button(`${icon(iconName)}<span>${label}</span>`, `tile-btn ${colour}`, action);
      button.setAttribute("aria-label", label);
      return button;
    };

    this.root.append(
      h(
        "div",
        { class: "menu-top" },
        h("div", { class: "top-run" }, h("div", { class: "label display" }, "TOP RUN"), this.topRun, this.multiplierChip),
        this.currency.root,
      ),
      h(
        "div",
        { class: "logo", role: "heading", "aria-level": "1", "aria-label": "Metro Dash" },
        h("span", { class: "word", "data-text": "METRO", "aria-hidden": "true" }, h("span", {}, "METRO")),
        h("span", { class: "word second", "data-text": "DASH", "aria-hidden": "true" }, h("span", {}, "DASH")),
      ),
      sceneArea,
      h("div", { class: "menu-missions" }, this.missions.root),
      playButton,
      h(
        "div",
        { class: "menu-bottom" },
        h(
          "div",
          { class: "group" },
          tile("Runners", "person", () => ui.open("characters"), "purple"),
          tile("Boards", "board", () => ui.open("boards")),
          tile("Shop", "shop", () => ui.open("shop"), "yellow"),
        ),
        h("div", { class: "group" }, h("div", { class: "mode-toggle", role: "group", "aria-label": "Control mode" }, this.keyboardMode, this.cameraMode)),
        h(
          "div",
          { class: "group" },
          tile("Settings", "gear", () => ui.open("settings")),
        ),
      ),
    );
    ui.save.events.on("change", (save) => this.refresh(save));
    this.refresh(ui.save.data);
  }

  protected override onShow(): void {
    this.refresh(this.ui.save.data);
  }

  private refresh(save: SaveData): void {
    this.topRun.textContent = formatNumber(save.highScore);
    this.multiplierChip.textContent = `Score x${1 + save.missions.level}`;
    this.missions.render(save.missions);
    this.currency.update(save);
    const camera = save.settings.inputMode === "camera";
    this.keyboardMode.classList.toggle("active", !camera);
    this.cameraMode.classList.toggle("active", camera);
    this.keyboardMode.setAttribute("aria-pressed", String(!camera));
    this.cameraMode.setAttribute("aria-pressed", String(camera));
  }
}
