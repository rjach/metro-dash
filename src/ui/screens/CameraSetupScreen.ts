import type { GameAction } from "../../game/actions";
import type { CalibrationProgress, CalibrationStatus } from "../../input/camera/Calibrator";
import type { CameraStatus } from "../../input/camera/CameraInput";
import type { LaneGesture } from "../../persistence/SaveData";
import { CameraService, type CameraErrorKind } from "../../input/camera/CameraService";
import { CameraPreview } from "../CameraPreview";
import { h } from "../dom";
import { icon, type IconName } from "../icons";
import { Screen } from "../Screen";
import type { UiController } from "../controller";

type Phase = "intro" | "connecting" | "error" | "calibrating" | "practice";

const ERROR_HELP: Record<CameraErrorKind, { title: string; help: string }> = {
  "permission-denied": {
    title: "Camera blocked",
    help: "Camera access was denied. Click the camera icon in your browser's address bar, allow access, then press Try again.",
  },
  "not-found": { title: "No camera found", help: "We couldn't find a webcam. Connect one (or enable it in your system settings) and try again." },
  "in-use": { title: "Camera is busy", help: "Another app or browser tab is using your camera. Close it, then press Try again." },
  "insecure-context": {
    title: "Secure connection needed",
    help: "Browsers only allow the camera on https:// pages or localhost. Open the game from a secure address.",
  },
  unsupported: { title: "Not supported", help: "This browser can't access cameras. Try the latest Chrome, Edge, Firefox or Safari." },
  overconstrained: { title: "Camera mode unsupported", help: "Your camera doesn't support the video mode we need. Try a different camera." },
  "model-load-failed": {
    title: "Motion tracking failed to load",
    help: "The on-device pose model couldn't start. Reload the page and try again; your GPU drivers may also need an update.",
  },
  "stream-ended": { title: "Camera disconnected", help: "The camera stopped sending video. Reconnect it and press Try again." },
  unknown: { title: "Camera problem", help: "Something went wrong starting the camera." },
};

const CALIBRATION_TEXT: Record<CalibrationStatus, { title: string; tip: string }> = {
  "no-person": { title: "Step into view", tip: "Stand back so your head, shoulders and hips are visible." },
  "too-far": { title: "Come a bit closer", tip: "Your shoulders should fill about a quarter of the picture." },
  "too-close": { title: "Step back", tip: "Move away until your hips are in the picture." },
  "off-center-left": { title: "Move right", tip: "Stand in the middle of the picture." },
  "off-center-right": { title: "Move left", tip: "Stand in the middle of the picture." },
  "hold-still": { title: "Hold still…", tip: "Stand naturally, arms relaxed." },
  calibrating: { title: "Calibrating…", tip: "Great! Stay still for a moment." },
  done: { title: "Calibrated!", tip: "Now try each move." },
};

const LANE_MOVES: Record<LaneGesture, { left: string; right: string }> = {
  hands: { left: "Left hand up", right: "Right hand up" },
  lean: { left: "Lean left", right: "Lean right" },
};

const MOVES: { action: GameAction; label: string; icon: IconName }[] = [
  { action: "left", label: "Left hand up", icon: "arrowLeft" },
  { action: "right", label: "Right hand up", icon: "arrowRight" },
  { action: "jump", label: "Jump", icon: "jump" },
  { action: "roll", label: "Crouch", icon: "crouch" },
];

const RING_LENGTH = 2 * Math.PI * 40;

const setAttributes = (element: Element, attributes: Record<string, string>): void => {
  for (const [key, value] of Object.entries(attributes)) element.setAttribute(key, value);
};

/** Guides the player from permission, through calibration, to practising every gesture. */
export class CameraSetupScreen extends Screen {
  private phase: Phase = "intro";
  private readonly preview: CameraPreview;
  private readonly stageMessage = h("div", { class: "overlay-msg" });
  private readonly statusTitle = h("div", { class: "cam-status" });
  private readonly tip = h("div", { class: "cam-tip" });
  private readonly actions = h("div", { class: "row", style: "justify-content:flex-start" });
  private readonly extra = h("div");
  private readonly ringCircle: SVGCircleElement;
  private readonly ring: SVGSVGElement;
  private readonly checks = new Map<GameAction, HTMLElement>();
  private readonly completed = new Set<GameAction>();

  constructor(ui: UiController) {
    super(ui, "camera-setup-screen dim");
    this.preview = new CameraPreview(ui.camera, "cam-stage");
    this.preview.guide = true;
    const ns = "http://www.w3.org/2000/svg";
    this.ring = document.createElementNS(ns, "svg");
    this.ring.setAttribute("viewBox", "0 0 100 100");
    this.ring.classList.add("progress-ring");
    const track = document.createElementNS(ns, "circle");
    setAttributes(track, { cx: "50", cy: "50", r: "40", fill: "rgba(0,0,0,.45)", stroke: "rgba(255,255,255,.3)", "stroke-width": "9" });
    this.ringCircle = document.createElementNS(ns, "circle");
    setAttributes(this.ringCircle, {
      cx: "50",
      cy: "50",
      r: "40",
      fill: "none",
      stroke: "#5ce65c",
      "stroke-width": "9",
      "stroke-linecap": "round",
      "stroke-dasharray": String(RING_LENGTH),
      "stroke-dashoffset": String(RING_LENGTH),
      transform: "rotate(-90 50 50)",
    });
    this.ring.append(track, this.ringCircle);
    this.preview.root.append(this.stageMessage, this.ring);

    const moveGrid = h("div", { class: "move-checks" });
    for (const move of MOVES) {
      const check = h("div", { class: "move-check", html: icon(move.icon) }, h("span", {}, move.label));
      this.checks.set(move.action, check);
      moveGrid.append(check);
    }
    this.extra.append(moveGrid);

    this.root.append(
      h(
        "div",
        { class: "header-bar" },
        h(
          "div",
          { class: "row" },
          this.button(icon("arrowLeft"), "icon", () => ui.cancelCameraSetup(), { "aria-label": "Back" }),
          h("div", { class: "display title" }, "Camera controls"),
        ),
      ),
      h(
        "div",
        { class: "cam-setup" },
        this.preview.root,
        h(
          "div",
          { class: "panel cam-side slide-up" },
          this.statusTitle,
          this.tip,
          this.extra,
          this.actions,
          h(
            "div",
            { class: "privacy", html: icon("shield") },
            h("span", {}, "Your video never leaves this device. Motion tracking runs entirely in your browser and nothing is uploaded or recorded."),
          ),
        ),
      ),
    );

    ui.camera.events.on("status", (status) => this.visible && this.onStatus(status));
    ui.camera.events.on("calibration", (progress) => this.visible && this.onCalibration(progress));
    ui.camera.events.on("gesture", ({ action }) => this.visible && this.onGesture(action as GameAction));
  }

  /** Called by the app when the flow starts; skips steps that are already satisfied. */
  begin(forceCalibration: boolean): void {
    this.completed.clear();
    for (const check of this.checks.values()) check.classList.remove("done");
    const labels = LANE_MOVES[this.ui.save.data.settings.laneGesture];
    this.checks.get("left")!.querySelector("span")!.textContent = labels.left;
    this.checks.get("right")!.querySelector("span")!.textContent = labels.right;
    const status = this.ui.camera.status;
    if (status.state === "running") {
      if (forceCalibration || !this.ui.camera.isCalibrated) this.enterCalibration();
      else this.enterPractice();
    } else if (status.state === "error") {
      this.enterError(status.error.kind, status.error.message);
    } else if (status.state === "starting" || status.state === "loading-model") {
      this.onStatus(status);
    } else {
      this.enterIntro();
      // Returning players who already allowed the camera skip the extra click.
      void CameraService.permissionGranted().then((granted) => {
        if (granted && this.visible && this.phase === "intro") this.ui.startCameraSetup();
      });
    }
  }

  protected override onShow(): void {
    this.preview.start();
  }

  protected override onHide(): void {
    this.preview.stop();
    if (this.phase === "calibrating") this.ui.camera.cancelCalibration();
  }

  private onStatus(status: CameraStatus): void {
    switch (status.state) {
      case "starting":
        this.setPhase("connecting", "Waiting for camera…", "Allow camera access when your browser asks.");
        this.stageMessage.replaceChildren(h("div", { class: "spinner" }));
        break;
      case "loading-model":
        this.setPhase("connecting", "Loading motion tracking…", "Preparing the on-device pose model (first time can take a few seconds).");
        this.stageMessage.replaceChildren(h("div", { class: "spinner" }));
        break;
      case "running":
        if (this.phase === "connecting" || this.phase === "intro" || this.phase === "error") {
          if (this.ui.camera.isCalibrated) this.enterPractice();
          else this.enterCalibration();
        }
        break;
      case "error":
        this.enterError(status.error.kind, status.error.message);
        break;
      case "off":
        if (this.phase !== "error") this.enterIntro();
        break;
    }
  }

  private onCalibration(progress: CalibrationProgress): void {
    if (this.phase !== "calibrating") return;
    const text = CALIBRATION_TEXT[progress.status];
    this.statusTitle.textContent = text.title;
    this.tip.textContent =
      progress.hipsHidden && progress.status !== "too-far" ? `${text.tip} Tip: step back so your hips are visible for the best lean detection.` : text.tip;
    this.ringCircle.setAttribute("stroke-dashoffset", String(RING_LENGTH * (1 - progress.progress)));
    this.ring.style.display = progress.progress > 0 ? "" : "none";
    if (progress.status === "done") {
      this.ui.sfx("purchase");
      this.enterPractice();
    }
  }

  private onGesture(action: GameAction): void {
    if (this.phase !== "practice") return;
    const check = this.checks.get(action);
    if (!check) return;
    this.completed.add(action);
    check.classList.add("done", "flash");
    setTimeout(() => check.classList.remove("flash"), 200);
    this.ui.sfx("coin");
    if (this.completed.size === MOVES.length) {
      this.statusTitle.textContent = "You're ready!";
      this.tip.textContent = "All moves detected. Remember: one gesture = one lane.";
    }
  }

  private enterIntro(): void {
    this.setPhase(
      "intro",
      "Play with your body",
      this.ui.save.data.settings.laneGesture === "hands"
        ? "Keep your hands down. Raise your left or right hand to chest height to switch lanes, jump to jump, crouch to slide. Both hands above your head = hoverboard."
        : "Lean or step sideways to switch lanes, jump to jump, crouch to slide. Raise both hands to use a hoverboard.",
    );
    this.stageMessage.replaceChildren(h("div", { class: "center-stack", html: icon("camera"), style: "width:5em" }));
    this.actions.replaceChildren(
      this.button(`${icon("camera")}Enable camera`, "green big", () => this.ui.startCameraSetup(), { "data-autofocus": "true" }),
      this.button(`${icon("keyboard")}Use keyboard`, "", () => this.useKeyboard()),
    );
  }

  private enterError(kind: CameraErrorKind, detail: string): void {
    const info = ERROR_HELP[kind];
    this.setPhase("error", info.title, "");
    this.tip.replaceChildren(
      h("div", { class: "error-box" }, h("div", {}, info.help), kind === "unknown" ? h("div", { class: "muted", style: "margin-top:0.4em" }, detail) : null),
    );
    this.stageMessage.replaceChildren(h("div", { html: icon("camera"), style: "width:4em; opacity:0.5" }));
    this.actions.replaceChildren(
      this.button(`${icon("refresh")}Try again`, "green", () => this.ui.retryCamera()),
      this.button(`${icon("keyboard")}Use keyboard`, "yellow", () => this.useKeyboard()),
    );
  }

  private enterCalibration(): void {
    this.setPhase("calibrating", CALIBRATION_TEXT["no-person"].title, CALIBRATION_TEXT["no-person"].tip);
    this.stageMessage.replaceChildren();
    this.ring.style.display = "none";
    this.ui.camera.startCalibration();
    this.actions.replaceChildren(this.button(`${icon("keyboard")}Use keyboard`, "", () => this.useKeyboard()));
  }

  private enterPractice(): void {
    this.setPhase(
      "practice",
      "Test your moves",
      this.ui.save.data.settings.laneGesture === "hands"
        ? "Try each move. Lower your hand after each raise — one raise = one lane."
        : "Try each move. Come back to the centre between leans — one lean = one lane.",
    );
    this.stageMessage.replaceChildren();
    this.ring.style.display = "none";
    this.actions.replaceChildren(
      this.button(`${icon("play")}Play!`, "green big", () => this.ui.finishCameraSetup(), { "data-autofocus": "true" }),
      this.button(`${icon("refresh")}Recalibrate`, "", () => this.enterCalibration()),
    );
  }

  private setPhase(phase: Phase, title: string, tip: string): void {
    this.phase = phase;
    this.statusTitle.textContent = title;
    this.tip.textContent = tip;
    this.extra.hidden = phase !== "practice";
    this.preview.guide = phase === "calibrating";
  }

  private useKeyboard(): void {
    this.ui.setInputMode("keyboard");
    this.ui.cancelCameraSetup();
  }
}
