import { AudioEngine, type SoundEffect } from "../audio/AudioEngine";
import { findBoard } from "../content/boards";
import { findCharacter } from "../content/characters";
import { HEADSTART } from "../core/config";
import type { GameAction } from "../game/actions";
import { GameSession } from "../game/GameSession";
import type { TimedPowerUp } from "../game/types";
import { CameraInput } from "../input/camera/CameraInput";
import { CameraService } from "../input/camera/CameraService";
import { AdaptivePoseEstimator } from "../input/camera/PoseEstimator";
import { InputManager, type UiCommand } from "../input/InputManager";
import { KeyboardInput } from "../input/KeyboardInput";
import { TouchInput } from "../input/TouchInput";
import type { InputMode, Settings } from "../persistence/SaveData";
import { resolveBrowserStore, SaveStore } from "../persistence/SaveStore";
import { GameRenderer } from "../render/GameRenderer";
import type { PurchaseResult, ScreenId, ShopItem, UiController } from "../ui/controller";
import { CameraSetupScreen } from "../ui/screens/CameraSetupScreen";
import { HudScreen } from "../ui/screens/HudScreen";
import { MainMenuScreen } from "../ui/screens/MainMenuScreen";
import { PauseScreen } from "../ui/screens/PauseScreen";
import { ResultsScreen } from "../ui/screens/ResultsScreen";
import { SaveMeScreen } from "../ui/screens/SaveMeScreen";
import { SettingsScreen } from "../ui/screens/SettingsScreen";
import { ShopScreen } from "../ui/screens/ShopScreen";
import { createBoardScreen, createCharacterScreen } from "./collections";
import { buildLoadout, Economy, hoverboardDuration } from "./Economy";
import { MissionCoordinator } from "./MissionCoordinator";
import { PerfOverlay } from "./PerfOverlay";
import { SessionFeedback } from "./SessionFeedback";
import { UIManager } from "./UIManager";

/** High-level flow of the application around the simulation's own phases. */
export type RunState = "menu" | "countdown" | "running" | "paused" | "trackingLost" | "crashed" | "saveMe" | "results";

const TRACKING_LOST_PAUSE_MS = 900;
const MENU_CHUNKS_BEHIND = 7;

/**
 * Composition root and application controller. It wires the save profile,
 * input devices, simulation, renderer, audio and UI together, and implements
 * every command the UI can issue. Game rules stay inside GameSession.
 */
export class App implements UiController {
  readonly save = new SaveStore(resolveBrowserStore());
  readonly audio = new AudioEngine();
  readonly input = new InputManager();
  readonly camera: CameraInput;
  readonly session: GameSession;
  readonly renderer: GameRenderer;
  private readonly ui = new UIManager();
  private readonly hud: HudScreen;
  private readonly results: ResultsScreen;
  private readonly saveMe: SaveMeScreen;
  private readonly cameraSetup: CameraSetupScreen;
  private readonly pauseScreen: PauseScreen;
  private readonly economy: Economy;
  private readonly missions: MissionCoordinator;
  private readonly perf: PerfOverlay;
  private runState: RunState = "menu";
  private countdown: { remaining: number; shown: number; onDone: () => void } | null = null;
  private lastFrame = performance.now();
  private trackingLostSince: number | null = null;
  private runCommitted = false;
  /** Best score before this run started; beating it mid-run is celebrated once. */
  private recordToBeat = 0;
  private recordAnnounced = false;

  constructor(root: HTMLElement) {
    const settings = this.save.data.settings;

    this.renderer = new GameRenderer(root);
    this.renderer.setQuality(settings.graphicsQuality);
    this.renderer.setReducedMotion(settings.reducedMotion);
    this.renderer.setCharacter(findCharacter(this.save.data.selectedCharacter));
    this.renderer.setBoard(findBoard(this.save.data.selectedBoard));

    this.session = new GameSession(buildLoadout(this.save.data));
    this.economy = new Economy(this.save, (ok) => this.sfx(ok ? "purchase" : "error"));

    this.camera = new CameraInput(this.input.emit, new CameraService(), new AdaptivePoseEstimator(), this.save.data.calibration);
    this.camera.setSensitivity(settings.cameraSensitivity);
    this.input.register(new KeyboardInput(this.input.emit));
    this.input.register(new TouchInput(this.input.emit, root));
    this.input.register(this.camera);
    this.input.get("keyboard")!.enable();
    this.input.get("touch")!.enable();

    this.hud = new HudScreen(this);
    this.results = new ResultsScreen(this);
    this.saveMe = new SaveMeScreen(this);
    this.cameraSetup = new CameraSetupScreen(this);
    this.ui.register("menu", new MainMenuScreen(this));
    this.ui.register("hud", this.hud);
    this.pauseScreen = new PauseScreen(this);
    this.ui.register("pause", this.pauseScreen);
    this.ui.register("saveMe", this.saveMe);
    this.ui.register("results", this.results);
    this.ui.register("characters", createCharacterScreen(this));
    this.ui.register("boards", createBoardScreen(this));
    this.ui.register("shop", new ShopScreen(this));
    this.ui.register("settings", new SettingsScreen(this));
    this.ui.register("cameraSetup", this.cameraSetup);
    this.perf = new PerfOverlay(this.renderer, this.session, this.camera);
    root.append(this.ui.layer, this.perf.root);

    this.missions = new MissionCoordinator(this.session, this.save, this.audio, this.hud, () => this.runState === "running");
    new SessionFeedback(this.session, this.audio, this.renderer, this.hud, this.save);
    this.session.events.on("crash", () => (this.runState = "crashed"));

    this.wireInput();
    this.wireCamera();
    this.wireEnvironment();
    this.applySettings(settings);
    this.goToMenu();
    requestAnimationFrame(this.frame);
  }

  // ─── Main loop ───────────────────────────────────────────────────────────

  private readonly frame = (now: number): void => {
    const dt = Math.min(0.1, Math.max(0, (now - this.lastFrame) / 1000));
    this.lastFrame = now;
    this.tickCountdown(dt);
    this.session.update(dt);
    if (this.runState === "crashed" && this.session.crashSettled) this.onCrashSettled();
    this.checkTrackingLoss(now);
    this.missions.update(dt);
    this.announceNewRecord();
    this.renderer.render(this.session, dt);
    if (this.hud.visible) this.hud.render(this.hudState());
    this.ui.update(dt);
    this.perf.update(dt);
    requestAnimationFrame(this.frame);
  };

  // ─── UiController: navigation ────────────────────────────────────────────

  play(): void {
    this.audio.unlock();
    if (this.runState !== "menu" && this.runState !== "results") return;
    if (this.save.data.settings.inputMode === "camera" && !(this.camera.status.state === "running" && this.camera.isCalibrated)) {
      this.openCameraSetup(false);
      return;
    }
    this.startRun();
  }

  open(screen: ScreenId): void {
    this.audio.unlock();
    if (screen === "characters" || screen === "boards") {
      this.renderer.setCameraMode("showcase");
      this.renderer.setBoardPreview(screen === "boards");
    }
    if (screen === "cameraSetup") {
      this.openCameraSetup(false);
      return;
    }
    this.ui.open(screen);
  }

  back(): void {
    const leaving = this.ui.current;
    const now = this.ui.back();
    if (leaving === "characters" || leaving === "boards") {
      this.renderer.setBoardPreview(false);
      if (now === "menu") this.renderer.setCameraMode("menu");
    }
  }

  pause(): void {
    if (this.runState === "countdown") {
      this.countdown = null;
      this.hud.clearCountdown();
    } else if (this.runState !== "running" && this.runState !== "trackingLost") {
      return;
    }
    this.session.pause();
    this.hud.setTrackingAlert(null);
    this.hud.hideTutorial();
    this.trackingLostSince = null;
    this.runState = "paused";
    this.audio.setMusicMood("paused");
    this.pauseScreen.showMissions(this.missions.snapshot);
    this.ui.open("pause");
  }

  resume(): void {
    if (this.runState !== "paused") return;
    this.ui.close("pause");
    this.ui.close("settings");
    this.audio.setMusicMood("run");
    this.startCountdown(() => {
      this.runState = "running";
      this.session.resume();
    });
  }

  restartRun(): void {
    if (this.runState === "paused") this.commitRun();
    this.ui.close("pause");
    this.ui.close("results");
    this.startRun();
  }

  quitToMenu(): void {
    if (this.runState !== "menu" && this.runState !== "results") this.commitRun();
    this.goToMenu();
  }

  revive(): void {
    if (this.runState !== "saveMe") return;
    const cost = this.session.reviveCost;
    if (this.save.data.keys < cost) {
      this.sfx("error");
      return;
    }
    this.save.update((draft) => {
      draft.keys -= cost;
    });
    this.session.revive();
    this.ui.close("saveMe");
    this.runState = "running";
    this.audio.setMusicMood("run");
    this.sfx("powerUp");
    this.hud.toast("Saved!");
  }

  skipRevive(): void {
    if (this.runState !== "saveMe") return;
    this.ui.close("saveMe");
    this.endRun();
  }

  // ─── UiController: input mode & camera ───────────────────────────────────

  setInputMode(mode: InputMode): void {
    if (this.save.data.settings.inputMode !== mode) {
      this.save.update((draft) => {
        draft.settings.inputMode = mode;
      });
    }
    this.hud.setCameraMode(mode, this.save.data.settings.showCameraPreview);
    if (mode === "keyboard") {
      this.camera.disable();
      this.trackingLostSince = null;
      if (this.ui.current === "cameraSetup") this.ui.close("cameraSetup");
      return;
    }
    if (this.camera.status.state !== "running" || !this.camera.isCalibrated) {
      if (this.runState === "running" || this.runState === "countdown") this.pause();
      this.openCameraSetup(false);
    }
  }

  startCameraSetup(): void {
    void this.camera.enable();
  }

  recalibrate(): void {
    this.openCameraSetup(true);
  }

  retryCamera(): void {
    this.camera.disable();
    void this.camera.enable();
  }

  finishCameraSetup(): void {
    this.ui.close("cameraSetup");
    if (this.save.data.settings.inputMode !== "camera") this.setInputMode("camera");
    this.hud.setCameraMode("camera", this.save.data.settings.showCameraPreview);
    // "Play!" at the end of setup always starts a run (unless we came from a paused run).
    const fromPausedRun = this.runState === "paused";
    if (!fromPausedRun && (this.runState === "menu" || this.runState === "results")) this.startRun();
  }

  cancelCameraSetup(): void {
    this.camera.cancelCalibration();
    if (!this.camera.isCalibrated || this.camera.status.state !== "running") {
      // Without a working, calibrated camera the only sensible control scheme is the keyboard.
      if (this.save.data.settings.inputMode === "camera") {
        this.save.update((draft) => {
          draft.settings.inputMode = "keyboard";
        });
      }
      this.camera.disable();
      this.hud.setCameraMode("keyboard", false);
    }
    this.ui.close("cameraSetup");
  }

  activateHoverboard(): void {
    this.session.handleAction("hoverboard");
  }

  useHeadstart(): void {
    if (this.runState !== "running" || this.save.data.headstarts <= 0) return;
    this.session.startHeadstart();
  }

  sfx(effect: SoundEffect): void {
    this.audio.unlock();
    this.audio.play(effect);
  }

  // ─── UiController: collections, shop, settings ───────────────────────────

  previewCharacter(id: string): void {
    this.renderer.setCharacter(findCharacter(id));
  }

  purchaseCharacter(id: string): PurchaseResult {
    return this.economy.purchaseCharacter(id);
  }

  selectCharacter(id: string): void {
    this.save.update((draft) => {
      draft.selectedCharacter = id;
    });
    this.renderer.setCharacter(findCharacter(id));
    this.sfx("purchase");
  }

  previewBoard(id: string): void {
    this.renderer.setBoard(findBoard(id));
  }

  purchaseBoard(id: string): PurchaseResult {
    return this.economy.purchaseBoard(id);
  }

  selectBoard(id: string): void {
    this.save.update((draft) => {
      draft.selectedBoard = id;
    });
    this.renderer.setBoard(findBoard(id));
    this.sfx("purchase");
  }

  purchaseUpgrade(kind: TimedPowerUp): PurchaseResult {
    return this.economy.purchaseUpgrade(kind);
  }

  purchaseItem(item: ShopItem): PurchaseResult {
    return this.economy.purchaseItem(item);
  }

  updateSettings(patch: Partial<Settings>): void {
    const next = this.save.update((draft) => {
      Object.assign(draft.settings, patch);
    });
    this.applySettings(next.settings);
  }

  resetProgress(): void {
    this.save.reset();
    this.renderer.setCharacter(findCharacter(this.save.data.selectedCharacter));
    this.renderer.setBoard(findBoard(this.save.data.selectedBoard));
    this.camera.setProfile(null);
    this.setInputMode("keyboard");
    this.sfx("powerDown");
  }

  // ─── Run lifecycle ───────────────────────────────────────────────────────

  private goToMenu(): void {
    this.countdown = null;
    this.trackingLostSince = null;
    this.hud.setTrackingAlert(null);
    this.session.updateLoadout(buildLoadout(this.save.data));
    this.session.resetRun();
    this.renderer.resetWorld();
    this.renderer.setBoardPreview(false);
    this.renderer.setCameraMode("menu");
    this.renderer.environmentBehind(MENU_CHUNKS_BEHIND);
    this.runState = "menu";
    this.audio.setMusicMood("menu");
    this.audio.startMusic();
    this.ui.reset("menu");
  }

  private startRun(): void {
    this.audio.unlock();
    this.runCommitted = false;
    this.recordToBeat = this.save.data.highScore;
    this.recordAnnounced = false;
    this.missions.startRun();
    this.session.updateLoadout(buildLoadout(this.save.data));
    this.session.resetRun();
    this.renderer.resetWorld();
    this.renderer.setBoardPreview(false);
    this.renderer.setCameraMode("game");
    this.renderer.environmentBehind(1);
    this.hud.setCameraMode(this.save.data.settings.inputMode, this.save.data.settings.showCameraPreview);
    this.ui.reset("hud");
    this.audio.setMusicMood("run");
    this.audio.startMusic();
    if (!this.save.data.tutorialSeen) this.hud.showTutorial(this.save.data.settings.inputMode);

    const begin = () => {
      this.runState = "running";
      this.session.start();
    };
    // Camera players need a moment to get into position; keyboard runs start immediately.
    if (this.save.data.settings.inputMode === "camera") this.startCountdown(begin);
    else begin();
  }

  private onCrashSettled(): void {
    const cost = this.session.reviveCost;
    if (this.save.data.keys >= cost) {
      this.runState = "saveMe";
      this.saveMe.offer(cost);
      this.ui.open("saveMe");
    } else {
      this.endRun();
    }
  }

  private endRun(): void {
    this.session.finish();
    const previousBest = this.save.data.highScore;
    this.commitRun();
    this.runState = "results";
    this.audio.setMusicMood("menu");
    const stats = this.session.stats;
    const newRecord = stats.score > previousBest && previousBest >= 0 && stats.score > 0;
    if (newRecord) this.sfx("newRecord");
    this.results.present({
      score: stats.score,
      coins: stats.coins,
      distance: stats.distance,
      highScore: this.save.data.highScore,
      newRecord,
      keys: stats.keys,
      totalCoins: this.save.data.coins,
      missions: this.save.data.missions,
    });
    this.ui.open("results");
  }

  /** Banks a run's coins and records exactly once, however the run ended. */
  private commitRun(): void {
    if (this.runCommitted || this.session.stats.duration <= 0) return;
    this.runCommitted = true;
    const stats = this.session.stats;
    this.save.update((draft) => {
      draft.coins += stats.coins;
      draft.highScore = Math.max(draft.highScore, Math.floor(stats.score));
      draft.bestDistance = Math.max(draft.bestDistance, Math.floor(stats.distance));
      draft.bestCoinsInRun = Math.max(draft.bestCoinsInRun, stats.coins);
      draft.totalRuns += 1;
      draft.totalCoinsCollected += stats.coins;
      draft.totalDistance += Math.floor(stats.distance);
      draft.tutorialSeen = true;
      draft.missions = this.missions.snapshot;
    });
  }

  private announceNewRecord(): void {
    if (this.recordAnnounced || this.runState !== "running" || this.recordToBeat <= 0) return;
    if (this.session.stats.score <= this.recordToBeat) return;
    this.recordAnnounced = true;
    this.sfx("newRecord");
    this.hud.toast("New high score!");
  }

  private startCountdown(onDone: () => void): void {
    this.runState = "countdown";
    this.countdown = { remaining: 3, shown: 0, onDone };
  }

  private tickCountdown(dt: number): void {
    const countdown = this.countdown;
    if (!countdown) return;
    const whole = Math.ceil(countdown.remaining);
    if (whole !== countdown.shown && whole > 0) {
      countdown.shown = whole;
      this.hud.showCountdown(whole);
      this.sfx("countdown");
    }
    countdown.remaining -= dt;
    if (countdown.remaining <= 0) {
      this.countdown = null;
      this.hud.showCountdown("GO!");
      this.sfx("go");
      setTimeout(() => this.hud.clearCountdown(), 600);
      countdown.onDone();
    }
  }

  // ─── Wiring ──────────────────────────────────────────────────────────────

  private wireInput(): void {
    this.input.events.on("action", ({ action }) => this.onAction(action));
    this.input.events.on("command", ({ command }) => this.onCommand(command));
    // Browsers only allow audio after a user gesture; start the menu groove on the first one.
    const unlock = () => {
      this.audio.unlock();
      this.audio.startMusic();
      window.removeEventListener("pointerdown", unlock);
      window.removeEventListener("keydown", unlock);
    };
    window.addEventListener("pointerdown", unlock);
    window.addEventListener("keydown", unlock);
  }

  private onAction(action: GameAction): void {
    this.audio.unlock();
    if (this.runState === "running") this.session.handleAction(action);
  }

  private onCommand(command: UiCommand): void {
    this.audio.unlock();
    switch (command) {
      case "pause":
        if (this.runState === "running" || this.runState === "countdown" || this.runState === "trackingLost") this.pause();
        else if (this.runState === "paused" && this.ui.current === "pause") this.resume();
        else if (this.ui.current !== "menu" && this.ui.current !== "hud" && this.ui.current !== "saveMe" && this.ui.current !== "results") this.back();
        return;
      case "confirm":
        if (this.ui.current === "menu") this.play();
        else if (this.ui.current === "results") this.restartRun();
        else if (this.ui.current === "saveMe") this.revive();
        else if (this.ui.current === "pause") this.resume();
        return;
      case "back":
        if (
          this.ui.current !== "menu" &&
          this.ui.current !== "hud" &&
          this.ui.current !== "saveMe" &&
          this.ui.current !== "results" &&
          this.ui.current !== "pause"
        ) {
          this.back();
        }
        return;
      case "headstart":
        this.useHeadstart();
        return;
      case "toggleInputMode":
        if (this.ui.current === "menu" || this.ui.current === "pause") {
          this.setInputMode(this.save.data.settings.inputMode === "camera" ? "keyboard" : "camera");
        }
        return;
    }
  }

  private wireCamera(): void {
    this.camera.events.on("calibration", (progress) => {
      if (progress.status !== "done" || !progress.profile) return;
      const profile = progress.profile;
      this.save.update((draft) => {
        draft.calibration = profile;
      });
    });
    this.camera.events.on("tracking", ({ tracking }) => {
      if (this.save.data.settings.inputMode !== "camera") return;
      if (!tracking) {
        this.trackingLostSince ??= performance.now();
        return;
      }
      this.trackingLostSince = null;
      if (this.runState === "trackingLost") {
        this.hud.setTrackingAlert(null);
        this.startCountdown(() => {
          this.runState = "running";
          this.session.resume();
        });
      }
    });
    this.camera.events.on("status", (status) => {
      if (status.state !== "error" || this.save.data.settings.inputMode !== "camera") return;
      if (this.ui.current === "cameraSetup") return;
      // The camera failed mid-session: fall back to the keyboard seamlessly.
      const inRun = this.runState === "running" || this.runState === "countdown" || this.runState === "trackingLost";
      if (inRun) this.pause();
      this.save.update((draft) => {
        draft.settings.inputMode = "keyboard";
      });
      this.hud.setCameraMode("keyboard", false);
      this.hud.setTrackingAlert(null);
      this.hud.toast("Camera lost — switched to keyboard", "warn");
    });
  }

  private checkTrackingLoss(now: number): void {
    if (this.trackingLostSince === null || this.runState !== "running") return;
    if (this.save.data.settings.inputMode !== "camera" || this.camera.status.state !== "running") return;
    if (now - this.trackingLostSince < TRACKING_LOST_PAUSE_MS) return;
    this.session.pause();
    this.runState = "trackingLost";
    this.hud.setTrackingAlert("Step back into the camera's view. The run resumes automatically — or press Esc to pause.");
  }

  private wireEnvironment(): void {
    window.addEventListener("resize", () => this.renderer.resize());
    document.addEventListener("visibilitychange", () => {
      if (document.hidden) {
        if (this.runState === "running" || this.runState === "countdown") this.pause();
        this.audio.suspend();
      } else {
        this.audio.resume();
      }
    });
    window.addEventListener("blur", () => {
      if (this.runState === "running") this.pause();
    });
  }

  private applySettings(settings: Settings): void {
    this.audio.setVolumes(settings.musicVolume, settings.sfxVolume, settings.muted);
    this.renderer.setQuality(settings.graphicsQuality);
    this.renderer.setReducedMotion(settings.reducedMotion);
    this.camera.setSensitivity(settings.cameraSensitivity);
    this.camera.setLaneGesture(settings.laneGesture);
    this.hud.setCameraMode(settings.inputMode, settings.showCameraPreview);
    this.perf.setVisible(settings.showFps);
  }

  private openCameraSetup(forceCalibration: boolean): void {
    this.ui.open("cameraSetup");
    this.cameraSetup.begin(forceCalibration);
  }

  // ─── Helpers ─────────────────────────────────────────────────────────────

  private hudState() {
    const session = this.session;
    return {
      score: session.stats.score,
      coins: session.stats.coins,
      multiplier: session.multiplier,
      multiplierBoosted: session.isPowerUpActive("multiplier"),
      powerUps: session.activePowerUps,
      hoverboards: session.hoverboardsAvailable,
      hoverboardActive: session.hoverboardActive,
      hoverboardFraction: session.hoverboardActive ? session.hoverboardTimeLeft / hoverboardDuration(this.save.data) : 0,
      headstartWindow: this.runState === "running" && session.headstartAvailable ? HEADSTART.offerSeconds - session.stats.duration : 0,
      headstarts: this.save.data.headstarts,
    };
  }

  /** Test hook: after a scripted `session.revive()`, bring the app flow back in sync. */
  debugForceRunning(): void {
    this.ui.close("saveMe");
    this.runState = "running";
  }

  /** Read-only view for automated tests and debugging. */
  debugState() {
    const player = this.session.player;
    return {
      runState: this.runState,
      phase: this.session.phase,
      screen: this.ui.current,
      score: Math.floor(this.session.stats.score),
      coins: this.session.stats.coins,
      distance: Math.floor(this.session.stats.distance),
      speed: this.session.speed,
      lane: player.lane,
      y: player.y,
      rolling: player.rolling,
      flying: player.flying,
      motion: player.motion,
      crashCause: this.session.crashCause,
      powerUps: this.session.activePowerUps.map((p) => p.kind),
      hoverboardActive: this.session.hoverboardActive,
      entities: this.session.obstacles.length + this.session.collectibles.length,
      pool: this.session.world.poolStats,
      camera: this.camera.status.state,
      tracking: this.camera.isTracking,
      inputMode: this.save.data.settings.inputMode,
      save: this.save.data,
      renderer: this.renderer.info,
    };
  }
}
