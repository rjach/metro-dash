import type { Difficulty, GraphicsQuality, InputMode, LaneGesture, Settings } from "../../persistence/SaveData";
import { h } from "../dom";
import { icon } from "../icons";
import { Screen } from "../Screen";
import type { UiController } from "../controller";

export class SettingsScreen extends Screen {
  private readonly body = h("div", { class: "scroll", style: "flex:1; min-height:0; padding-right: 0.3em" });
  private confirmingReset = false;

  constructor(ui: UiController) {
    super(ui, "settings-screen dim");
    this.root.append(
      h(
        "div",
        { class: "center-stack", style: "height:100%" },
        h(
          "div",
          { class: "panel settings pop-in", style: "padding-top: 2em" },
          h("div", { class: "panel-title display" }, "Settings"),
          this.body,
          h(
            "div",
            { class: "row", style: "margin-top: 0.8em" },
            this.button(`${icon("check")}Done`, "green", () => ui.back(), { "data-autofocus": "true" }),
          ),
        ),
      ),
    );
    // No blanket re-render on save changes: that would replace a slider mid-drag.
    // Discrete controls (toggles, segmented buttons) refresh themselves explicitly.
  }

  protected override onShow(): void {
    this.confirmingReset = false;
    this.refresh();
  }

  private refresh(): void {
    const settings = this.ui.save.data.settings;
    const update = (patch: Partial<Settings>) => this.ui.updateSettings(patch);
    const calibrated = this.ui.save.data.calibration !== null;
    this.body.replaceChildren(
      h("div", { class: "setting-group" }, "Audio"),
      this.slider("Music", settings.musicVolume, (value) => update({ musicVolume: value })),
      this.slider("Sound effects", settings.sfxVolume, (value) => update({ sfxVolume: value })),
      this.toggle("Mute all", settings.muted, (value) => update({ muted: value })),
      h("div", { class: "setting-group" }, "Gameplay"),
      this.segmented<Difficulty>(
        "Difficulty",
        [
          ["easy", "Easy"],
          ["normal", "Normal"],
          ["hard", "Hard"],
        ],
        settings.difficulty,
        (value) => update({ difficulty: value }),
      ),
      h("div", { class: "setting-group" }, "Controls"),
      this.segmented<InputMode>(
        "Control mode",
        [
          ["keyboard", "Keyboard"],
          ["camera", "Camera"],
        ],
        settings.inputMode,
        (value) => this.ui.setInputMode(value),
      ),
      this.segmented<LaneGesture>(
        "Camera lane gesture",
        [
          ["hands", "Raise hand"],
          ["lean", "Lean / step"],
        ],
        settings.laneGesture,
        (value) => update({ laneGesture: value }),
      ),
      this.slider(
        "Camera sensitivity",
        (settings.cameraSensitivity - 0.5) / 1,
        (value) => update({ cameraSensitivity: 0.5 + value }),
        "Higher = smaller movements trigger actions",
      ),
      this.toggle("Show camera preview in game", settings.showCameraPreview, (value) => update({ showCameraPreview: value })),
      h(
        "div",
        { class: "setting" },
        h("span", {}, calibrated ? "Camera calibrated" : "Camera not calibrated yet"),
        this.button(`${icon("camera")}${calibrated ? "Recalibrate" : "Set up"}`, "", () => this.ui.recalibrate()),
      ),
      h("div", { class: "setting-group" }, "Graphics"),
      this.segmented<GraphicsQuality>(
        "Quality",
        [
          ["low", "Low"],
          ["medium", "Medium"],
          ["high", "High"],
        ],
        settings.graphicsQuality,
        (value) => update({ graphicsQuality: value }),
      ),
      this.toggle("Reduced motion (no camera shake)", settings.reducedMotion, (value) => update({ reducedMotion: value })),
      this.toggle("Show performance stats", settings.showFps, (value) => update({ showFps: value })),
      h("div", { class: "setting-group" }, "How to play"),
      h(
        "div",
        { class: "kbd-help" },
        h("b", {}, "← → / A D"),
        h("span", {}, "Change lane · camera: raise your left/right hand to chest height, then lower it"),
        h("b", {}, "↑ / W"),
        h("span", {}, "Jump · camera: jump"),
        h("b", {}, "↓ / S"),
        h("span", {}, "Roll (slams down mid-air) · camera: crouch"),
        h("b", {}, "Space"),
        h("span", {}, "Hoverboard · camera: both hands above head"),
        h("b", {}, "H"),
        h("span", {}, "Headstart (first seconds of a run)"),
        h("b", {}, "Esc / P"),
        h("span", {}, "Pause"),
        h("b", {}, "Swipe"),
        h("span", {}, "Touch screens: swipe to move, double-tap for hoverboard"),
      ),
      h("div", { class: "setting-group" }, "Progress"),
      h(
        "div",
        { class: "setting" },
        h("span", {}, this.confirmingReset ? "Really erase coins, unlocks and records?" : "Reset all progress"),
        this.confirmingReset
          ? h(
              "div",
              { class: "row" },
              this.button("Cancel", "", () => {
                this.confirmingReset = false;
                this.refresh();
              }),
              this.button("Erase", "red", () => {
                this.confirmingReset = false;
                this.ui.resetProgress();
              }),
            )
          : this.button("Reset", "red", () => {
              this.confirmingReset = true;
              this.refresh();
            }),
      ),
    );
    if (!this.ui.save.persistenceAvailable) {
      this.body.prepend(
        h("div", { class: "error-box" }, "Progress can't be saved in this browser (storage is blocked). It will reset when you close the tab."),
      );
    }
  }

  private slider(label: string, value: number, onChange: (value: number) => void, hint?: string): HTMLElement {
    const input = h("input", { type: "range", min: 0, max: 1, step: 0.05, value, "aria-label": label });
    input.addEventListener("input", () => onChange(Number(input.value)));
    return h("label", { class: "setting" }, h("span", {}, label, hint ? h("div", { class: "muted", style: "font-size:0.75em" }, hint) : null), input);
  }

  private toggle(label: string, value: boolean, onChange: (value: boolean) => void): HTMLElement {
    const button = h("button", { class: "switch", type: "button", role: "switch", "aria-checked": String(value), "aria-label": label });
    button.addEventListener("click", () => {
      this.ui.sfx("click");
      onChange(!value);
      this.refresh();
    });
    return h("div", { class: "setting" }, h("span", {}, label), button);
  }

  private segmented<T extends string>(label: string, options: [T, string][], value: T, onChange: (value: T) => void): HTMLElement {
    const group = h("div", { class: "segmented", role: "radiogroup", "aria-label": label });
    for (const [option, text] of options) {
      const button = h("button", { type: "button", role: "radio", "aria-checked": String(option === value), class: option === value ? "active" : "" }, text);
      button.addEventListener("click", () => {
        this.ui.sfx("click");
        onChange(option);
        if (this.visible) this.refresh();
      });
      group.append(button);
    }
    return h("div", { class: "setting" }, h("span", {}, label), group);
  }
}
