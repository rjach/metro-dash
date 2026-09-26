import type { MissionState } from "../../game/missions";
import { h } from "../dom";
import { icon } from "../icons";
import { MissionsPanel } from "../MissionsPanel";
import { Screen } from "../Screen";
import type { UiController } from "../controller";

export class PauseScreen extends Screen {
  private readonly soundButton: HTMLButtonElement;
  private readonly modeInfo = h("div", { class: "muted", style: "text-align:center; font-size:0.85em" });
  private readonly keyboardMode: HTMLButtonElement;
  private readonly cameraMode: HTMLButtonElement;
  private readonly missions = new MissionsPanel();

  constructor(ui: UiController) {
    super(ui, "pause-screen dim");
    this.soundButton = this.button(icon("sound"), "icon", () => ui.updateSettings({ muted: !ui.save.data.settings.muted }), { "aria-label": "Toggle sound" });
    const resume = this.button(`${icon("play")}Resume`, "green big", () => ui.resume(), { "data-autofocus": "true" });
    this.keyboardMode = h("button", { type: "button", html: `${icon("keyboard")}<span>Keyboard</span>` });
    this.cameraMode = h("button", { type: "button", html: `${icon("camera")}<span>Camera</span>` });
    this.keyboardMode.addEventListener("click", () => {
      ui.sfx("click");
      ui.setInputMode("keyboard");
      this.onShow();
    });
    this.cameraMode.addEventListener("click", () => {
      ui.sfx("click");
      ui.setInputMode("camera");
    });
    this.root.append(
      h(
        "div",
        { class: "center-stack" },
        h(
          "div",
          { class: "panel pop-in", style: "width:100%; display:flex; flex-direction:column; gap:1em; align-items:center; padding-top:2em" },
          h("div", { class: "panel-title display" }, "Paused"),
          resume,
          h(
            "div",
            { class: "row" },
            this.button(`${icon("home")}Home`, "", () => ui.quitToMenu()),
            this.button(`${icon("refresh")}Restart`, "yellow", () => ui.restartRun()),
            this.button(icon("gear"), "icon", () => ui.open("settings"), { "aria-label": "Settings" }),
            this.soundButton,
          ),
          h("div", { class: "mode-toggle", role: "group", "aria-label": "Control mode" }, this.keyboardMode, this.cameraMode),
          this.modeInfo,
        ),
        this.missions.root,
      ),
    );
  }

  /** Live mission progress for the current run (includes not-yet-saved progress). */
  showMissions(state: MissionState): void {
    this.missions.render(state);
  }

  protected override onShow(): void {
    const settings = this.ui.save.data.settings;
    this.soundButton.innerHTML = icon(settings.muted ? "mute" : "sound");
    const camera = settings.inputMode === "camera";
    this.keyboardMode.classList.toggle("active", !camera);
    this.cameraMode.classList.toggle("active", camera);
    this.keyboardMode.setAttribute("aria-pressed", String(!camera));
    this.cameraMode.setAttribute("aria-pressed", String(camera));
    this.modeInfo.textContent = camera ? "Camera controls active · the keyboard always works as a backup" : "Arrow keys / WASD to move · Space for hoverboard";
  }
}
