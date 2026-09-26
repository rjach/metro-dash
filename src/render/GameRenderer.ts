import * as THREE from "three";
import type { BoardDef } from "../content/boards";
import type { CharacterDef } from "../content/characters";
import { damp } from "../core/math";
import type { GameSession } from "../game/GameSession";
import type { PlayerMotion } from "../game/types";
import type { GraphicsQuality } from "../persistence/SaveData";
import { BoardModel } from "./BoardModel";
import { CameraRig, type CameraMode } from "./CameraRig";
import { DogModel, HumanModel } from "./HumanModel";
import { Atmosphere } from "./Atmosphere";
import { EnvironmentView } from "./EnvironmentView";
import { transparent } from "./materials";
import { Particles } from "./Particles";
import { setPbrAnisotropy } from "./pbrTextures";
import { PostFX, type PostQuality } from "./PostFX";
import { setMaxAnisotropy, shadowTexture } from "./textures";
import { WorldView } from "./WorldView";

const GUARD_LOOK = {
  palette: {
    skin: "#f0c29e",
    hair: "#4a3526",
    top: "#23395d",
    topAccent: "#c6ff3d",
    bottom: "#1c2a44",
    shoes: "#1b1b1b",
    shoesAccent: "#444444",
    hat: "#23395d",
  },
  hairStyle: "guardCap" as const,
  accessory: "mustache" as const,
};

interface QualityProfile {
  pixelRatio: number;
  detail: number;
  shadows: "off" | "medium" | "high";
  post: PostQuality;
}

/** Ride height of the hoverboard deck above the ground. */
const HOVER_HEIGHT = 0.3;

const QUALITY: Record<GraphicsQuality, QualityProfile> = {
  low: { pixelRatio: 0.85, detail: 0, shadows: "off", post: "low" },
  medium: { pixelRatio: 1, detail: 1, shadows: "medium", post: "medium" },
  high: { pixelRatio: 1.5, detail: 1, shadows: "high", post: "high" },
};

/**
 * Owns the Three.js scene and draws the current simulation state. It reads
 * the session but never mutates it, keeping presentation fully separate from
 * gameplay rules.
 */
export class GameRenderer {
  readonly renderer: THREE.WebGLRenderer;
  readonly rig: CameraRig;
  private readonly scene = new THREE.Scene();
  private readonly environment = new EnvironmentView();
  private readonly worldView = new WorldView();
  private readonly particles = new Particles();
  private readonly playerRoot = new THREE.Group();
  private readonly chaserRoot = new THREE.Group();
  private readonly atmosphere: Atmosphere;
  private readonly post: PostFX;
  private readonly shadow: THREE.Mesh;
  private shadowsEnabled = true;
  private readonly shadowFocus = new THREE.Vector3();
  private character: HumanModel | null = null;
  private board: BoardModel | null = null;
  private readonly guard = new HumanModel(GUARD_LOOK, 1.04);
  private readonly dog = new DogModel();
  private time = 0;
  private lastPlayerZ = 0;
  private lastPlayerX = 0;
  private motionTime = 0;
  private lastMotion: PlayerMotion = "idle";
  private boardPreview = false;
  private hoverHeight = HOVER_HEIGHT;
  private hoverVelocity = 0;
  private lastRiderVy = 0;
  private contextLost = false;

  constructor(private readonly container: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1;
    this.renderer.shadowMap.enabled = true;
    // Post-processing renders several passes per frame; count the whole frame, not the last pass.
    this.renderer.info.autoReset = false;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.domElement.className = "game-canvas";
    this.renderer.domElement.addEventListener("webglcontextlost", (event) => {
      event.preventDefault();
      this.contextLost = true;
    });
    this.renderer.domElement.addEventListener("webglcontextrestored", () => {
      this.contextLost = false;
    });
    container.appendChild(this.renderer.domElement);
    setMaxAnisotropy(this.renderer.capabilities.getMaxAnisotropy());
    setPbrAnisotropy(Math.min(8, this.renderer.capabilities.getMaxAnisotropy()));

    this.rig = new CameraRig(container.clientWidth / Math.max(1, container.clientHeight));
    this.atmosphere = new Atmosphere(this.scene, this.renderer);
    this.post = new PostFX(this.renderer, this.scene, this.rig.camera);

    this.scene.add(this.environment.root);
    this.scene.add(this.worldView.root);
    this.scene.add(this.particles.mesh);

    this.shadow = new THREE.Mesh(new THREE.PlaneGeometry(1.3, 1.3), transparent(shadowTexture(), 1, "shadow"));
    this.shadow.rotation.x = -Math.PI / 2;
    this.scene.add(this.shadow);

    this.playerRoot.rotation.y = Math.PI;
    this.scene.add(this.playerRoot);
    this.chaserRoot.add(this.guard.root);
    this.dog.root.position.set(-1.0, 0, 0.9);
    this.dog.root.rotation.y = Math.PI;
    this.chaserRoot.add(this.dog.root);
    this.guard.root.rotation.y = Math.PI;
    this.scene.add(this.chaserRoot);

    this.worldView.prewarm();
    this.environment.prewarm();
    this.resize();
    this.warmUp();
  }

  // ─── Configuration ───────────────────────────────────────────────────────

  setQuality(quality: GraphicsQuality): void {
    const profile = QUALITY[quality];
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, profile.pixelRatio));
    this.environment.setDetail(profile.detail);
    this.atmosphere.setShadowQuality(profile.shadows);
    this.shadowsEnabled = profile.shadows !== "off";
    this.post.setQuality(profile.post);
    this.resize();
  }

  setReducedMotion(reduced: boolean): void {
    this.rig.setShakeEnabled(!reduced);
  }

  setCharacter(def: CharacterDef): void {
    if (this.character) {
      this.playerRoot.remove(this.character.root);
      this.disposeObject(this.character.root);
    }
    this.character = new HumanModel({ palette: def.palette, hairStyle: def.hairStyle, accessory: def.accessory });
    this.playerRoot.add(this.character.root);
  }

  setBoard(def: BoardDef): void {
    if (this.board) {
      this.playerRoot.remove(this.board.root);
      this.board.dispose();
    }
    this.board = new BoardModel(def);
    this.board.root.visible = false;
    this.playerRoot.add(this.board.root);
  }

  /** Shows the runner standing on the board in the board-selection screen. */
  setBoardPreview(enabled: boolean): void {
    this.boardPreview = enabled;
  }

  setCameraMode(mode: CameraMode): void {
    this.rig.setMode(mode);
  }

  /** How many scenery chunks to keep behind the runner (the menu camera looks backwards). */
  environmentBehind(chunks: number): void {
    this.environment.setChunksBehind(chunks);
  }

  resize(): void {
    const width = Math.max(1, this.container.clientWidth);
    const height = Math.max(1, this.container.clientHeight);
    this.renderer.setSize(width, height, false);
    this.post.setSize(width, height, this.renderer.getPixelRatio());
    this.rig.setAspect(width / height);
  }

  resetWorld(): void {
    this.worldView.reset();
    this.environment.reset();
    this.particles.clear();
    this.lastPlayerZ = 0;
  }

  // ─── Effects hooks (driven by session events) ────────────────────────────

  coinBurst(x: number, y: number, z: number, playerZ: number): void {
    this.particles.emit({ count: 3, position: new THREE.Vector3(x, y, -(z - playerZ)), color: "#ffe066", speed: 2.5, size: 0.5, life: 0.35 });
  }

  pickupBurst(color: THREE.ColorRepresentation): void {
    const player = this.playerRoot.position;
    this.particles.emit({
      count: 26,
      position: new THREE.Vector3(player.x, player.y + 1, player.z),
      color,
      speed: 6,
      size: 0.7,
      life: 0.6,
      spread: new THREE.Vector3(0.6, 0.6, 0.6),
    });
  }

  landingDust(): void {
    const player = this.playerRoot.position;
    this.particles.emit({
      count: 8,
      position: new THREE.Vector3(player.x, player.y + 0.1, player.z),
      color: "#b8a58c",
      speed: 2,
      size: 0.6,
      life: 0.4,
      gravity: 2,
      worldLocked: true,
    });
  }

  boardShatter(color: THREE.ColorRepresentation): void {
    const player = this.playerRoot.position;
    this.particles.emit({ count: 34, position: new THREE.Vector3(player.x, player.y + 0.3, player.z), color, speed: 8, size: 0.45, life: 0.8, gravity: 12 });
    this.rig.shake(0.35);
  }

  impact(strength: number): void {
    this.rig.shake(strength);
  }

  // ─── Frame ───────────────────────────────────────────────────────────────

  render(session: GameSession, dt: number): void {
    if (this.contextLost) return;
    this.renderer.info.reset();
    this.time += dt;
    const player = session.player;
    const playerZ = player.z;
    const worldShift = playerZ - this.lastPlayerZ;
    this.lastPlayerZ = playerZ;

    this.environment.update(playerZ);
    this.worldView.sync(session.obstacles, session.collectibles, playerZ, this.time, this.rig.camera);
    this.updatePlayer(session, dt);
    this.updateChaser(session, dt);
    this.updateAtmosphere(dt, session);
    this.emitSpeedStreaks(session, dt);
    this.particles.update(dt, Math.max(0, worldShift), this.rig.camera);

    this.rig.update(dt, { playerX: player.x, playerY: player.y, speed: session.phase === "running" ? session.speed : 0, flying: player.flying });
    this.post.render(dt);
  }

  get info(): { calls: number; triangles: number; geometries: number; textures: number } {
    const { render, memory } = this.renderer.info;
    return { calls: render.calls, triangles: render.triangles, geometries: memory.geometries, textures: memory.textures };
  }

  private updatePlayer(session: GameSession, dt: number): void {
    const player = session.player;
    const character = this.character;
    if (!character) return;
    const lateralVelocity = dt > 0 ? (player.x - this.lastPlayerX) / dt : 0;
    this.lastPlayerX = player.x;
    this.playerRoot.position.set(player.x, player.y, 0);
    // Turntable sway in the character/board showcase so the model reads in 3D.
    const showcase = this.rig.currentMode === "showcase" && session.phase === "idle";
    this.playerRoot.rotation.y = damp(this.playerRoot.rotation.y, Math.PI + (showcase ? Math.sin(this.time * 0.6) * 0.55 : 0), 4, dt);

    const riding = session.hoverboardActive || (this.boardPreview && session.phase === "idle");
    const motion: PlayerMotion = session.phase === "idle" && !this.boardPreview ? "idle" : player.motion;
    if (motion !== this.lastMotion) {
      this.lastMotion = motion;
      this.motionTime = 0;
    }
    this.motionTime += dt;
    character.update(
      dt,
      {
        motion: this.boardPreview && session.phase === "idle" ? "run" : motion,
        speed: session.phase === "running" ? session.speed : 0,
        lateralVelocity,
        verticalVelocity: player.vy,
        riding,
        rollProgress: 1 - player.rollTimer / 0.62,
        timeInMotion: this.motionTime,
      },
      this.time,
    );
    character.setJetpackVisible(player.flying);
    character.setMagnetVisible(session.isPowerUpActive("magnet"));
    character.setSneakerGlow(session.isPowerUpActive("sneakers"));

    // Hover suspension: a damped spring holds the deck ~0.3 m up; landings compress it.
    const hoverTarget = HOVER_HEIGHT + Math.sin(this.time * 3.6) * 0.025;
    if (riding && this.lastRiderVy < -6 && player.vy === 0) this.hoverVelocity -= 2.2;
    this.lastRiderVy = player.vy;
    this.hoverVelocity += ((hoverTarget - this.hoverHeight) * 180 - this.hoverVelocity * 14) * dt;
    this.hoverHeight += this.hoverVelocity * dt;
    const onBoard = riding && !player.flying;
    character.root.position.y = onBoard ? this.hoverHeight + 0.06 : 0;
    if (this.board) {
      this.board.root.visible = onBoard;
      this.board.root.position.y = this.hoverHeight;
      // Bank into lane changes and pitch with vertical motion, like a carving board.
      this.board.root.rotation.set(THREE.MathUtils.clamp(player.vy * 0.015, -0.2, 0.2), 0, THREE.MathUtils.clamp(lateralVelocity * 0.025, -0.3, 0.3));
      this.board.update(this.time);
    }

    // Blink while invulnerable after a revive or a board save.
    this.playerRoot.visible = !player.invulnerable || Math.floor(this.time * 14) % 2 === 0;

    const shadowScale = Math.max(0.35, 1 - (player.y - player.groundY) * 0.12);
    this.shadow.position.set(player.x, player.groundY + 0.03, 0);
    this.shadow.scale.setScalar(shadowScale);
    // Real shadow maps replace the blob shadow unless shadows are disabled (low quality).
    this.shadow.visible = !this.shadowsEnabled && (!player.flying || player.y < 6);
  }

  private updateChaser(session: GameSession, dt: number): void {
    const proximity = session.chase.proximity;
    const phase = session.phase;
    const player = session.player;
    const inMenu = phase === "idle";
    this.chaserRoot.visible = inMenu ? !this.boardPreview && this.rig.currentMode === "menu" : proximity > 0.03;
    if (!this.chaserRoot.visible) return;
    const behind = inMenu ? 3.2 : THREE.MathUtils.lerp(13, 2.6, proximity);
    const caught = session.chase.mode === "caught";
    // Chase slightly off to one side so the guard never hides the runner from the camera.
    const sideOffset = player.x > 0.5 ? -1.25 : 1.25;
    const targetX = inMenu ? -1.6 : caught ? player.x : player.x + sideOffset;
    this.chaserRoot.position.set(damp(this.chaserRoot.position.x, targetX, 4, dt), 0, caught ? 1.4 : behind);
    const running = !inMenu && phase === "running";
    this.guard.update(
      dt,
      {
        motion: running ? "run" : "idle",
        speed: session.speed,
        lateralVelocity: 0,
        verticalVelocity: 0,
        riding: false,
        rollProgress: 0,
        timeInMotion: 0,
      },
      this.time,
    );
    this.dog.update(running ? dt : dt * 0.2, running ? session.speed : 0);
  }

  private updateAtmosphere(_dt: number, session: GameSession): void {
    // Keep the shadow frustum centred just ahead of the runner, where detail matters.
    this.shadowFocus.set(session.player.x * 0.5, 0, -14);
    this.atmosphere.update(this.shadowFocus, this.environment.tunnelAmount);
  }

  private streakTimer = 0;

  private emitSpeedStreaks(session: GameSession, dt: number): void {
    if (session.phase !== "running") return;
    const intensity = session.player.flying ? 1 : Math.max(0, (session.speed - 22) / 12);
    if (intensity <= 0) return;
    this.streakTimer -= dt;
    if (this.streakTimer > 0) return;
    this.streakTimer = 0.05 / intensity;
    const side = Math.random() < 0.5 ? -1 : 1;
    this.particles.emit({
      count: 1,
      position: new THREE.Vector3(session.player.x + side * (2.5 + Math.random() * 3), session.player.y + 0.5 + Math.random() * 3, -25),
      color: "#ffffff",
      speed: 60,
      size: 0.08,
      life: 0.45,
      direction: new THREE.Vector3(0, 0, 1),
      stretch: 40,
    });
  }

  /**
   * Draws every pooled (hidden) object once during boot — behind the loading
   * screen — so shaders compile and geometry/textures upload now instead of
   * stalling a frame when a rare obstacle or the first tunnel appears.
   */
  private warmUp(): void {
    const revealed: THREE.Object3D[] = [];
    const culled: THREE.Object3D[] = [];
    for (const root of [this.environment.root, this.worldView.root]) {
      for (const child of root.children) {
        if (!child.visible) {
          child.visible = true;
          revealed.push(child);
        }
      }
      root.traverse((object) => {
        if (object.frustumCulled) {
          object.frustumCulled = false;
          culled.push(object);
        }
      });
    }
    this.renderer.compile(this.scene, this.rig.camera);
    this.renderer.render(this.scene, this.rig.camera);
    for (const object of revealed) object.visible = false;
    for (const object of culled) object.frustumCulled = true;
  }

  private disposeObject(root: THREE.Object3D): void {
    root.traverse((object) => {
      if (object instanceof THREE.Mesh) object.geometry.dispose();
    });
  }
}
