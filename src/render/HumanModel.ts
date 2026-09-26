import * as THREE from "three";
import type { Accessory, CharacterPalette, HairStyle } from "../content/characters";
import { clamp, damp } from "../core/math";
import type { PlayerMotion } from "../game/types";
import { emissive, MATERIALS, paint } from "./materials";

export type HumanStyle = HairStyle | "guardCap";
export type HumanAccessory = Accessory | "mustache";

export interface HumanLook {
  palette: CharacterPalette;
  hairStyle: HumanStyle;
  accessory: HumanAccessory;
}

export interface AnimationInput {
  motion: PlayerMotion;
  speed: number;
  /** Lateral velocity (m/s) — the body banks into lane changes. */
  lateralVelocity: number;
  verticalVelocity: number;
  riding: boolean;
  /** 0..1 progress through a slide. */
  rollProgress: number;
  timeInMotion: number;
}

/** Adult proportions in metres (≈1.75 m tall). */
const HIP_HEIGHT = 0.93;
const THIGH = 0.44;
const SHIN = 0.43;
const UPPER_ARM = 0.29;
const FOREARM = 0.26;

/** Every animated degree of freedom of the rig (radians / metres). */
interface Pose {
  pelvisY: number;
  pelvisZ: number;
  pelvisPitch: number;
  pelvisYaw: number;
  pelvisRoll: number;
  spinePitch: number;
  spineYaw: number;
  spineRoll: number;
  neckPitch: number;
  neckYaw: number;
  shoulderFlexL: number;
  shoulderFlexR: number;
  shoulderAbductL: number;
  shoulderAbductR: number;
  elbowL: number;
  elbowR: number;
  hipFlexL: number;
  hipFlexR: number;
  hipAbductL: number;
  hipAbductR: number;
  kneeL: number;
  kneeR: number;
  ankleL: number;
  ankleR: number;
}

const neutral = (): Pose => ({
  pelvisY: HIP_HEIGHT,
  pelvisZ: 0,
  pelvisPitch: 0,
  pelvisYaw: 0,
  pelvisRoll: 0,
  spinePitch: 0,
  spineYaw: 0,
  spineRoll: 0,
  neckPitch: 0,
  neckYaw: 0,
  shoulderFlexL: 0,
  shoulderFlexR: 0,
  shoulderAbductL: 0.08,
  shoulderAbductR: 0.08,
  elbowL: 0.15,
  elbowR: 0.15,
  hipFlexL: 0,
  hipFlexR: 0,
  hipAbductL: 0.02,
  hipAbductR: 0.02,
  kneeL: 0.04,
  kneeR: 0.04,
  ankleL: 0,
  ankleR: 0,
});

/** Critically-damped spring used for secondary motion. */
class Spring {
  value = 0;
  velocity = 0;
  constructor(
    private readonly stiffness: number,
    private readonly damping: number,
  ) {}
  step(target: number, dt: number): number {
    const force = (target - this.value) * this.stiffness - this.velocity * this.damping;
    this.velocity += force * dt;
    this.value += this.velocity * dt;
    return this.value;
  }
  kick(velocity: number): void {
    this.velocity += velocity;
  }
}

const pivot = (x = 0, y = 0, z = 0): THREE.Group => {
  const group = new THREE.Group();
  group.position.set(x, y, z);
  return group;
};

/**
 * Limb segment turned on a lathe from a radius profile, so muscles taper
 * naturally instead of reading as capsules. Hangs down from its pivot.
 */
const limb = (length: number, radii: number[], material: THREE.Material, depthScale = 0.92): THREE.Mesh => {
  const points = radii.map((radius, i) => new THREE.Vector2(radius, -(i / (radii.length - 1)) * length));
  points.unshift(new THREE.Vector2(0.0001, 0));
  points.push(new THREE.Vector2(0.0001, -length));
  const geometry = new THREE.LatheGeometry(points, 18);
  const mesh = new THREE.Mesh(geometry, material);
  mesh.scale.set(1, 1, depthScale);
  return mesh;
};

const sphere = (radius: number, material: THREE.Material, w = 18, h = 14): THREE.Mesh => new THREE.Mesh(new THREE.SphereGeometry(radius, w, h), material);

/** Smooth bump used to sculpt the head. */
const bump = (d: number, width: number) => Math.exp(-(d * d) / (width * width));

/**
 * Procedurally built, physically shaded human with a biomechanical
 * animation system. The same rig drives every runner and the guard.
 */
export class HumanModel {
  readonly root = new THREE.Group();
  private readonly pose = neutral();
  private readonly joints: Record<string, THREE.Group> = {};
  private readonly shoeMaterials: THREE.MeshPhysicalMaterial[] = [];
  private readonly jetpack: THREE.Group;
  private readonly flames: THREE.Mesh[] = [];
  private readonly magnet: THREE.Group;
  private readonly eyelids: THREE.Mesh[] = [];
  private readonly ponytail: THREE.Group | null;
  private readonly backpack: THREE.Group | null;
  private runPhase = 0;
  private blinkTimer = 2;
  private lastMotion: PlayerMotion = "idle";
  private readonly landing = new Spring(160, 16);
  private readonly lean = new Spring(40, 9);
  private readonly hairSwing = new Spring(60, 5);
  private readonly packBounce = new Spring(120, 8);
  private crash = { angle: 0, velocity: 0, slide: 0 };

  constructor(look: HumanLook, scale = 1) {
    const { ponytail, backpack } = this.build(look);
    this.ponytail = ponytail;
    this.backpack = backpack;
    this.root.scale.setScalar(scale);
    this.jetpack = this.buildJetpack();
    this.jetpack.visible = false;
    this.joints.chest!.add(this.jetpack);
    this.magnet = this.buildMagnet();
    this.magnet.visible = false;
    this.joints.handR!.add(this.magnet);
    this.root.traverse((object) => {
      if (object instanceof THREE.Mesh) {
        object.castShadow = true;
        object.receiveShadow = true;
      }
    });
  }

  setJetpackVisible(visible: boolean): void {
    this.jetpack.visible = visible;
  }

  setMagnetVisible(visible: boolean): void {
    this.magnet.visible = visible;
  }

  /** Super sneakers glow green. */
  setSneakerGlow(active: boolean): void {
    for (const material of this.shoeMaterials) {
      material.emissive.set(active ? "#27ff7a" : "#000000");
      material.emissiveIntensity = active ? 1.4 : 0;
    }
  }

  /** Height of the soles above the root, used to keep a hoverboard under the feet. */
  get feetHeight(): number {
    return Math.max(0, this.pose.pelvisY - HIP_HEIGHT);
  }

  update(dt: number, input: AnimationInput, time: number): void {
    if (input.motion !== this.lastMotion) this.onMotionChange(this.lastMotion, input);
    this.lastMotion = input.motion;
    const target = this.targetPose(input, dt, time);
    const sharpness = input.motion === "roll" ? 22 : input.motion === "crashed" ? 30 : input.motion === "run" ? 26 : 12;
    const pose = this.pose;
    for (const key of Object.keys(pose) as (keyof Pose)[]) pose[key] = damp(pose[key], target[key], sharpness, dt);
    this.applySecondary(input, dt, time);
    this.apply();
    for (const flame of this.flames) flame.scale.set(1, 0.75 + Math.random() * 0.5, 1);
  }

  // ─── Pose synthesis ──────────────────────────────────────────────────────

  private onMotionChange(previous: PlayerMotion, input: AnimationInput): void {
    // Landing: compress the legs with a spring kick proportional to fall speed.
    if ((previous === "fall" || previous === "jump") && (input.motion === "run" || input.motion === "roll")) this.landing.kick(-1.6);
    if (input.motion === "crashed") this.crash = { angle: 0, velocity: -2.4, slide: 0 };
    if (input.motion === "stumble") this.lean.kick(3);
  }

  private targetPose(input: AnimationInput, dt: number, time: number): Pose {
    const pose = neutral();
    const bank = clamp(-input.lateralVelocity * 0.028, -0.32, 0.32);

    if (input.riding && input.motion !== "crashed" && input.motion !== "jetpack" && input.motion !== "stumble") return this.ridePose(pose, input, bank, time);

    switch (input.motion) {
      case "idle":
        return this.idlePose(pose, time);
      case "run":
        return this.runPose(pose, input, dt, bank);
      case "jump":
      case "fall":
        return this.airPose(pose, input, bank);
      case "roll":
        return this.slidePose(pose, input);
      case "jetpack":
        return this.flightPose(pose, bank, time);
      case "stumble":
        return this.stumblePose(pose, input);
      case "crashed":
        return this.crashPose(pose, dt);
    }
  }

  private idlePose(pose: Pose, time: number): Pose {
    const breath = Math.sin(time * 1.9);
    const sway = Math.sin(time * 0.55);
    pose.pelvisRoll = sway * 0.035;
    pose.pelvisY = HIP_HEIGHT - 0.01 + breath * 0.004;
    pose.spinePitch = -0.02 + breath * 0.015;
    pose.spineRoll = -sway * 0.03;
    pose.neckYaw = Math.sin(time * 0.37) * 0.22;
    pose.neckPitch = 0.04 + Math.sin(time * 0.61) * 0.04;
    pose.hipAbductL = 0.06 + sway * 0.02;
    pose.hipAbductR = 0.06 - sway * 0.02;
    pose.kneeL = 0.06 + Math.max(0, sway) * 0.1;
    pose.kneeR = 0.06 + Math.max(0, -sway) * 0.1;
    pose.shoulderAbductL = pose.shoulderAbductR = 0.1;
    pose.elbowL = 0.25 + breath * 0.03;
    pose.elbowR = 0.22 - breath * 0.03;
    pose.shoulderFlexL = 0.05;
    pose.shoulderFlexR = 0.08;
    return pose;
  }

  /** Sprint gait: phase-locked hip/knee/ankle curves with pelvis bounce and counter-rotating arms. */
  private runPose(pose: Pose, input: AnimationInput, dt: number, bank: number): Pose {
    const cadence = 2.6 + input.speed * 0.045;
    this.runPhase = (this.runPhase + dt * cadence * Math.PI) % (Math.PI * 2);
    const p = this.runPhase;
    const leg = (phase: number) => {
      const s = Math.sin(phase);
      // Knee folds hard during the forward swing (heel toward glutes), nearly straight at push-off.
      const swing = Math.max(0, Math.sin(phase + 0.9));
      return {
        hip: 0.62 * s + 0.12,
        knee: 0.22 + 1.75 * swing ** 1.6,
        ankle: -0.35 * Math.sin(phase - 0.6),
      };
    };
    const left = leg(p);
    const right = leg(p + Math.PI);
    pose.hipFlexL = left.hip;
    pose.hipFlexR = right.hip;
    pose.kneeL = left.knee;
    pose.kneeR = right.knee;
    pose.ankleL = left.ankle;
    pose.ankleR = right.ankle;
    pose.hipAbductL = pose.hipAbductR = 0.03;
    // Flight phase twice per stride lifts the pelvis; contact drops it.
    pose.pelvisY = HIP_HEIGHT - 0.06 + Math.abs(Math.cos(p)) * 0.07;
    pose.pelvisYaw = Math.sin(p) * 0.14;
    pose.pelvisRoll = bank + Math.cos(p) * 0.04;
    pose.spinePitch = 0.2;
    pose.spineYaw = -Math.sin(p) * 0.24;
    pose.neckPitch = -0.14;
    pose.neckYaw = Math.sin(p) * 0.1;
    // Arms swing opposite the legs with elbows near 90°.
    pose.shoulderFlexL = -0.75 * Math.sin(p + Math.PI) + 0.1;
    pose.shoulderFlexR = -0.75 * Math.sin(p) + 0.1;
    pose.elbowL = 1.45 + Math.sin(p) * 0.2;
    pose.elbowR = 1.45 - Math.sin(p) * 0.2;
    pose.shoulderAbductL = pose.shoulderAbductR = 0.14;
    return pose;
  }

  private airPose(pose: Pose, input: AnimationInput, bank: number): Pose {
    const rising = input.verticalVelocity > 1;
    const falling = input.verticalVelocity < -4;
    pose.pelvisRoll = bank;
    pose.pelvisY = HIP_HEIGHT + 0.02;
    pose.spinePitch = rising ? 0.08 : 0.18;
    pose.neckPitch = -0.1;
    // Athletic tuck on the way up, legs reach for the ground on the way down.
    pose.hipFlexL = rising ? 1.15 : falling ? 0.45 : 0.9;
    pose.hipFlexR = rising ? 0.35 : falling ? 0.2 : 0.6;
    pose.kneeL = rising ? 1.65 : falling ? 0.45 : 1.3;
    pose.kneeR = rising ? 1.1 : falling ? 0.35 : 1.0;
    pose.ankleL = pose.ankleR = rising ? -0.3 : 0.1;
    pose.shoulderFlexL = rising ? 1.9 : 0.6;
    pose.shoulderFlexR = rising ? 1.3 : 0.4;
    pose.shoulderAbductL = pose.shoulderAbductR = rising ? 0.35 : 0.7;
    pose.elbowL = pose.elbowR = rising ? 0.6 : 0.4;
    return pose;
  }

  /** Baseball slide under a barrier: lean back, lead leg out, trailing leg folded, hand trailing. */
  private slidePose(pose: Pose, input: AnimationInput): Pose {
    const settle = clamp(input.rollProgress * 4, 0, 1);
    pose.pelvisY = HIP_HEIGHT - 0.62 * settle;
    pose.pelvisPitch = -1.05 * settle;
    pose.spinePitch = 0.45 * settle;
    pose.neckPitch = 0.5 * settle;
    pose.hipFlexL = 1.5 * settle;
    pose.kneeL = 0.12;
    pose.ankleL = 0.25;
    pose.hipFlexR = 0.35;
    pose.kneeR = 2.1 * settle;
    pose.hipAbductR = 0.22;
    pose.shoulderFlexL = -0.55;
    pose.shoulderAbductL = 0.55;
    pose.elbowL = 0.15;
    pose.shoulderFlexR = 1.2;
    pose.shoulderAbductR = 0.3;
    pose.elbowR = 0.7;
    return pose;
  }

  /** Snowboard stance on the hoverboard; "down" becomes a deep crouch grabbing the board edge. */
  private ridePose(pose: Pose, input: AnimationInput, bank: number, time: number): Pose {
    const carve = Math.sin(time * 1.7) * 0.04;
    const crouch = input.motion === "roll";
    const airborne = input.motion === "jump" || input.motion === "fall";
    pose.pelvisYaw = 1.15;
    pose.spineYaw = -0.55;
    pose.neckYaw = -0.55;
    pose.pelvisRoll = bank * 1.2 + carve;
    const bend = crouch ? 1 : airborne ? 0.75 : 0.4;
    pose.pelvisY = HIP_HEIGHT - 0.05 - bend * 0.36;
    pose.spinePitch = 0.18 + bend * 0.4;
    pose.neckPitch = -0.2 - bend * 0.2;
    pose.hipFlexL = 0.35 + bend * 1.0;
    pose.hipFlexR = 0.35 + bend * 1.0;
    pose.hipAbductL = pose.hipAbductR = 0.28;
    pose.kneeL = 0.6 + bend * 1.25;
    pose.kneeR = 0.6 + bend * 1.25;
    pose.ankleL = pose.ankleR = -0.2 - bend * 0.25;
    if (crouch) {
      // Trailing hand grabs the board's toe edge.
      pose.shoulderFlexR = 0.6;
      pose.shoulderAbductR = 0.1;
      pose.elbowR = 0.1;
      pose.shoulderFlexL = 0.9;
      pose.shoulderAbductL = 0.9;
      pose.elbowL = 0.5;
    } else {
      pose.shoulderAbductL = 1.05 + carve * 2;
      pose.shoulderAbductR = 0.95 - carve * 2;
      pose.shoulderFlexL = 0.35;
      pose.shoulderFlexR = -0.2;
      pose.elbowL = 0.45;
      pose.elbowR = 0.35;
    }
    return pose;
  }

  private flightPose(pose: Pose, bank: number, time: number): Pose {
    const hover = Math.sin(time * 4.2) * 0.04;
    pose.pelvisPitch = 0.5;
    pose.pelvisRoll = bank * 1.3;
    pose.spinePitch = 0.12;
    pose.neckPitch = -0.55;
    pose.hipFlexL = -0.15 + hover;
    pose.hipFlexR = 0.05 - hover;
    pose.kneeL = 0.55;
    pose.kneeR = 0.8;
    pose.ankleL = pose.ankleR = 0.45;
    pose.shoulderFlexL = pose.shoulderFlexR = 0.25;
    pose.shoulderAbductL = pose.shoulderAbductR = 0.3;
    pose.elbowL = pose.elbowR = 1.5;
    return pose;
  }

  private stumblePose(pose: Pose, input: AnimationInput): Pose {
    const wobble = Math.sin(input.timeInMotion * 18) * Math.exp(-input.timeInMotion * 3);
    pose.pelvisY = HIP_HEIGHT - 0.08;
    pose.spinePitch = 0.5 + wobble * 0.2;
    pose.pelvisRoll = wobble * 0.25;
    pose.neckPitch = -0.35;
    pose.hipFlexL = 0.8;
    pose.hipFlexR = -0.3;
    pose.kneeL = 1.1;
    pose.kneeR = 0.4;
    pose.shoulderFlexL = 1.4 + wobble;
    pose.shoulderFlexR = 1.1 - wobble;
    pose.shoulderAbductL = pose.shoulderAbductR = 0.6;
    pose.elbowL = pose.elbowR = 0.5;
    return pose;
  }

  /**
   * Impact physics: the body topples backwards as a falling pendulum, bounces
   * once on the ground and settles, with limbs going limp.
   */
  private crashPose(pose: Pose, dt: number): Pose {
    const crash = this.crash;
    // Toppling pendulum (θ < 0 = leaning back): gravity pulls it further over until it hits the ground.
    const gravityOverLength = 9.81 / 0.95;
    crash.velocity += (gravityOverLength * Math.sin(crash.angle) - 0.8) * dt;
    crash.angle += crash.velocity * dt;
    if (crash.angle < -1.42) {
      crash.angle = -1.42;
      crash.velocity = Math.abs(crash.velocity) * 0.25;
      if (Math.abs(crash.velocity) < 0.2) crash.velocity = 0;
    }
    crash.slide = damp(crash.slide, 0.55, 3, dt);
    const lying = -crash.angle / 1.42;
    pose.pelvisPitch = crash.angle;
    pose.pelvisY = HIP_HEIGHT * (1 - lying) + 0.16 * lying;
    pose.pelvisZ = crash.slide;
    pose.spinePitch = -0.1 * lying;
    pose.neckPitch = 0.3 * lying;
    pose.shoulderFlexL = 2.2 * lying;
    pose.shoulderFlexR = 1.9 * lying;
    pose.shoulderAbductL = pose.shoulderAbductR = 0.8 * lying + 0.2;
    pose.elbowL = pose.elbowR = 0.35;
    pose.hipFlexL = 0.45 * lying;
    pose.hipFlexR = 0.15 * lying;
    pose.kneeL = 0.7 * lying;
    pose.kneeR = 0.25;
    return pose;
  }

  private applySecondary(input: AnimationInput, dt: number, time: number): void {
    const landing = this.landing.step(0, dt);
    this.pose.pelvisY += Math.min(0, landing) * 0.12;
    this.pose.kneeL += Math.max(0, -landing) * 0.45;
    this.pose.kneeR += Math.max(0, -landing) * 0.45;
    const lean = this.lean.step(0, dt);
    this.pose.spinePitch += lean * 0.1;
    if (this.ponytail) {
      const swing = this.hairSwing.step(-input.verticalVelocity * 0.035 + Math.sin(this.runPhase * 2) * 0.12, dt);
      this.ponytail.rotation.x = 0.35 + swing + this.pose.spinePitch * 0.5;
      this.ponytail.rotation.z = -input.lateralVelocity * 0.02;
    }
    if (this.backpack) this.backpack.position.y = 0.26 + this.packBounce.step(Math.abs(Math.cos(this.runPhase)) * 0.015, dt);
    // Blink every few seconds.
    this.blinkTimer -= dt;
    const closed = this.blinkTimer < 0.12;
    if (this.blinkTimer < 0) this.blinkTimer = 2 + Math.abs(Math.sin(time * 12.9898)) * 3;
    for (const lid of this.eyelids) lid.scale.y = closed ? 1 : 0.55;
  }

  private apply(): void {
    const j = this.joints;
    const pose = this.pose;
    j.pelvis!.position.set(0, pose.pelvisY, pose.pelvisZ);
    j.pelvis!.rotation.set(pose.pelvisPitch, pose.pelvisYaw, pose.pelvisRoll, "YXZ");
    j.spine!.rotation.set(pose.spinePitch * 0.5, pose.spineYaw * 0.5, pose.spineRoll * 0.5);
    j.chest!.rotation.set(pose.spinePitch * 0.5, pose.spineYaw * 0.5, pose.spineRoll * 0.5);
    j.neck!.rotation.set(pose.neckPitch, pose.neckYaw, 0);
    // Flexion swings a limb forward (+z); the model faces +z, so that is a negative X rotation.
    j.shoulderL!.rotation.set(-pose.shoulderFlexL, 0, -pose.shoulderAbductL);
    j.shoulderR!.rotation.set(-pose.shoulderFlexR, 0, pose.shoulderAbductR);
    j.elbowL!.rotation.x = -pose.elbowL;
    j.elbowR!.rotation.x = -pose.elbowR;
    j.hipL!.rotation.set(-pose.hipFlexL, 0, -pose.hipAbductL);
    j.hipR!.rotation.set(-pose.hipFlexR, 0, pose.hipAbductR);
    j.kneeL!.rotation.x = pose.kneeL;
    j.kneeR!.rotation.x = pose.kneeR;
    j.ankleL!.rotation.x = pose.ankleL;
    j.ankleR!.rotation.x = pose.ankleR;
  }

  // ─── Construction ────────────────────────────────────────────────────────

  private build(look: HumanLook): { ponytail: THREE.Group | null; backpack: THREE.Group | null } {
    const { palette } = look;
    const skin = MATERIALS.skin(palette.skin);
    const top = MATERIALS.fabric(palette.top);
    const accent = MATERIALS.fabric(palette.topAccent);
    const pants = MATERIALS.denim(palette.bottom);
    const guard = look.hairStyle === "guardCap";

    const pelvis = pivot(0, HIP_HEIGHT, 0);
    this.root.add(pelvis);
    this.joints.pelvis = pelvis;
    // Hips/seat.
    const hips = limb(0.22, [0.14, 0.165, 0.17, 0.155, 0.12], pants, 0.78);
    hips.position.y = 0.1;
    pelvis.add(hips);
    const belt = new THREE.Mesh(new THREE.TorusGeometry(0.145, 0.018, 8, 24), MATERIALS.leather("#2a1d14"));
    belt.rotation.x = Math.PI / 2;
    belt.scale.set(1.05, 0.78, 1);
    belt.position.y = 0.07;
    pelvis.add(belt);

    const spine = pivot(0, 0.1, 0);
    pelvis.add(spine);
    const chest = pivot(0, 0.18, 0);
    spine.add(chest);
    this.joints.spine = spine;
    this.joints.chest = chest;
    // Torso: waist → ribcage → shoulders, flattened front-to-back.
    const torso = limb(0.5, [0.118, 0.138, 0.155, 0.163, 0.162, 0.152, 0.128, 0.095, 0.07], top, 0.7);
    torso.rotation.x = Math.PI;
    torso.position.y = -0.18;
    torso.scale.set(1.1, 1, 0.74);
    chest.add(torso);
    // Hoodie details: pocket, hood and drawstrings.
    const pocket = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.09, 0.006), top);
    pocket.position.set(0, -0.09, 0.106);
    chest.add(pocket);
    if (!guard) {
      const hood = new THREE.Mesh(new THREE.TorusGeometry(0.1, 0.045, 8, 16, Math.PI * 1.4), top);
      hood.rotation.set(Math.PI / 2 + 0.35, 0, Math.PI * 1.2);
      hood.position.set(0, 0.27, -0.05);
      chest.add(hood);
      for (const x of [-0.035, 0.035]) {
        const string = new THREE.Mesh(new THREE.CylinderGeometry(0.004, 0.004, 0.14, 5), accent);
        string.position.set(x, 0.18, 0.105);
        chest.add(string);
      }
    } else {
      // High-visibility vest with reflective bands.
      const vest = limb(0.36, [0.15, 0.165, 0.17, 0.165, 0.15], MATERIALS.fabric(palette.topAccent), 0.72);
      vest.rotation.x = Math.PI;
      vest.position.y = -0.1;
      vest.scale.set(1.16, 1, 0.72);
      chest.add(vest);
      for (const y of [0.0, 0.1]) {
        const band = new THREE.Mesh(new THREE.TorusGeometry(0.17, 0.012, 6, 28), MATERIALS.reflective("#e8ecef"));
        band.rotation.x = Math.PI / 2;
        band.scale.set(1.13, 0.74, 1);
        band.position.y = y;
        chest.add(band);
      }
    }

    const neck = pivot(0, 0.3, 0);
    chest.add(neck);
    this.joints.neck = neck;
    const neckMesh = limb(0.11, [0.06, 0.05, 0.047, 0.05], skin, 0.95);
    neckMesh.rotation.x = Math.PI;
    neckMesh.position.y = -0.03;
    neck.add(neckMesh);
    const head = pivot(0, 0.06, 0.012);
    neck.add(head);
    this.buildHead(head, look);
    const ponytail = this.buildHair(head, look);

    for (const side of [-1, 1] as const) this.buildArm(chest, side, top, skin, look);
    for (const side of [-1, 1] as const) this.buildLeg(pelvis, side, pants, palette);

    let backpack: THREE.Group | null = null;
    if (look.accessory === "backpack") {
      backpack = pivot(0, 0.26, -0.13);
      const bag = limb(0.4, [0.1, 0.13, 0.14, 0.13, 0.1], MATERIALS.fabric(palette.hat), 0.55);
      bag.scale.set(1.25, 1, 0.55);
      backpack.add(bag);
      const flap = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.12, 0.02), MATERIALS.leather("#2a2a2a"));
      flap.position.set(0, -0.12, -0.07);
      backpack.add(flap);
      chest.add(backpack);
      for (const x of [-0.09, 0.09]) {
        const strap = new THREE.Mesh(new THREE.TorusGeometry(0.14, 0.012, 6, 16, Math.PI), MATERIALS.leather("#2a2a2a"));
        strap.rotation.y = Math.PI / 2;
        strap.position.set(x, 0.2, -0.02);
        chest.add(strap);
      }
    }
    return { ponytail, backpack };
  }

  private buildHead(head: THREE.Group, look: HumanLook): void {
    const skin = MATERIALS.skin(look.palette.skin);
    // Sculpt a sphere into a skull: jaw taper, chin, cheekbones, brow ridge, fuller cranium.
    const geometry = new THREE.SphereGeometry(0.1, 48, 36);
    const position = geometry.attributes.position as THREE.BufferAttribute;
    const v = new THREE.Vector3();
    for (let i = 0; i < position.count; i++) {
      v.fromBufferAttribute(position, i).divideScalar(0.1);
      const front = Math.max(0, v.z);
      if (v.y < -0.15) v.x *= 1 - 0.24 * clamp((-v.y - 0.15) / 0.85, 0, 1);
      if (v.y < -0.55) v.z += 0.12 * front * clamp((-v.y - 0.55) / 0.45, 0, 1);
      v.z += 0.07 * bump(v.y - 0.22, 0.12) * front * bump(v.x, 0.55);
      v.x += Math.sign(v.x) * 0.05 * bump(v.y + 0.12, 0.2) * front;
      v.z -= 0.13 * bump(Math.abs(v.x) - 0.36, 0.14) * bump(v.y - 0.05, 0.12) * front;
      if (v.z < 0 && v.y > -0.2) v.z *= 1.06;
      position.setXYZ(i, v.x * 0.079, v.y * 0.104, v.z * 0.1);
    }
    geometry.computeVertexNormals();
    const skull = new THREE.Mesh(geometry, skin);
    skull.position.y = 0.11;
    head.add(skull);

    // Nose: bridge and tip.
    const nose = new THREE.Mesh(new THREE.ConeGeometry(0.011, 0.042, 10), skin);
    nose.rotation.x = -Math.PI / 2 + 0.45;
    nose.scale.set(0.8, 1, 1);
    nose.position.set(0, 0.094, 0.103);
    head.add(nose);
    const tip = sphere(0.0095, skin, 10, 8);
    tip.scale.set(1.15, 0.85, 1);
    tip.position.set(0, 0.078, 0.112);
    head.add(tip);
    // Lips.
    const lipMaterial = MATERIALS.skin(new THREE.Color(look.palette.skin).lerp(new THREE.Color("#8a3b3b"), 0.35).getStyle());
    for (const [y, scale] of [
      [0.054, 0.8],
      [0.047, 1],
    ] as const) {
      const lip = new THREE.Mesh(new THREE.CapsuleGeometry(0.0048, 0.026, 4, 8), lipMaterial);
      lip.rotation.z = Math.PI / 2;
      lip.scale.set(scale, 1, 0.7);
      lip.position.set(0, y, 0.096);
      head.add(lip);
    }
    // Eyes with iris, pupil and eyelids.
    const iris = MATERIALS.iris(look.palette.hair === "#8e3bd6" ? "#3d6a4a" : "#4a3222");
    for (const x of [-0.033, 0.033]) {
      const eye = sphere(0.0118, MATERIALS.eyeWhite(), 14, 10);
      eye.position.set(x, 0.116, 0.084);
      head.add(eye);
      const irisDisc = new THREE.Mesh(new THREE.CircleGeometry(0.0056, 16), iris);
      irisDisc.position.set(x, 0.116, 0.0957);
      head.add(irisDisc);
      const pupil = new THREE.Mesh(new THREE.CircleGeometry(0.0026, 12), paint("#050505", 0.1));
      pupil.position.set(x, 0.116, 0.0961);
      head.add(pupil);
      const lid = new THREE.Mesh(new THREE.SphereGeometry(0.0128, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2), skin);
      lid.position.set(x, 0.116, 0.084);
      lid.rotation.x = 0.2;
      head.add(lid);
      this.eyelids.push(lid);
      const brow = new THREE.Mesh(new THREE.CapsuleGeometry(0.0032, 0.024, 4, 6), MATERIALS.hair(look.palette.hair));
      brow.rotation.z = Math.PI / 2 + (x > 0 ? -0.1 : 0.1);
      brow.position.set(x, 0.136, 0.094);
      head.add(brow);
    }
    // Ears.
    for (const side of [-1, 1]) {
      const ear = new THREE.Mesh(new THREE.TorusGeometry(0.018, 0.008, 6, 12), skin);
      ear.scale.set(0.7, 1.2, 1);
      ear.rotation.y = Math.PI / 2;
      ear.position.set(side * 0.08, 0.105, -0.005);
      head.add(ear);
    }
    if (look.accessory === "mustache") {
      const mustache = new THREE.Mesh(new THREE.CapsuleGeometry(0.009, 0.045, 4, 8), MATERIALS.hair("#4b3a2c"));
      mustache.rotation.z = Math.PI / 2;
      mustache.position.set(0, 0.064, 0.103);
      head.add(mustache);
    }
  }

  /** Hair shell displaced with fine noise so it catches light like hair rather than plastic. */
  private hairShell(radius: number, coverage: number, material: THREE.Material, roughness = 0.012): THREE.Mesh {
    const geometry = new THREE.SphereGeometry(radius, 36, 24, 0, Math.PI * 2, 0, Math.PI * coverage);
    const position = geometry.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < position.count; i++) {
      const x = position.getX(i);
      const y = position.getY(i);
      const z = position.getZ(i);
      const n = 1 + (Math.sin(x * 190) * Math.cos(z * 170) + Math.sin(y * 230)) * roughness;
      position.setXYZ(i, x * n * 0.82, y * n, z * n * 1.02);
    }
    geometry.computeVertexNormals();
    return new THREE.Mesh(geometry, material);
  }

  private buildHair(head: THREE.Group, look: HumanLook): THREE.Group | null {
    const hair = MATERIALS.hair(look.palette.hair);
    const hatColor = look.palette.hat;
    const shell = this.hairShell(0.106, 0.46, hair);
    shell.rotation.x = -0.35;
    shell.position.set(0, 0.13, -0.012);
    let ponytail: THREE.Group | null = null;
    switch (look.hairStyle) {
      case "capBack":
      case "guardCap": {
        head.add(shell);
        const capMaterial = look.hairStyle === "guardCap" ? MATERIALS.fabric("#1c2c47") : MATERIALS.fabric(hatColor);
        const dome = new THREE.Mesh(new THREE.SphereGeometry(0.108, 32, 16, 0, Math.PI * 2, 0, Math.PI / 2.1), capMaterial);
        dome.scale.set(0.86, 0.95, 1.04);
        dome.position.y = 0.14;
        head.add(dome);
        const brimShape = new THREE.Shape();
        brimShape.absellipse(0, 0, 0.085, 0.075, 0, Math.PI, true, 0);
        const brim = new THREE.Mesh(
          new THREE.ExtrudeGeometry(brimShape, { depth: 0.006, bevelEnabled: false }),
          look.hairStyle === "guardCap" ? MATERIALS.leather("#101010") : capMaterial,
        );
        brim.rotation.x = Math.PI / 2 + (look.hairStyle === "guardCap" ? 0.15 : -0.1);
        const facing = look.hairStyle === "guardCap" ? 1 : -1;
        brim.position.set(0, 0.155, facing * 0.075);
        if (facing < 0) brim.rotation.y = Math.PI;
        head.add(brim);
        if (look.hairStyle === "guardCap") {
          const badge = new THREE.Mesh(new THREE.CircleGeometry(0.014, 12), MATERIALS.steel("#d9b24a", 0.25));
          badge.position.set(0, 0.2, 0.1);
          head.add(badge);
          const band = new THREE.Mesh(new THREE.TorusGeometry(0.093, 0.01, 6, 24), MATERIALS.leather("#101010"));
          band.rotation.x = Math.PI / 2;
          band.scale.set(0.86, 1.04, 1);
          band.position.y = 0.155;
          head.add(band);
        }
        break;
      }
      case "ponytail": {
        head.add(shell);
        ponytail = pivot(0, 0.2, -0.085);
        const tail = limb(0.22, [0.022, 0.03, 0.026, 0.018, 0.008], hair, 0.8);
        ponytail.add(tail);
        const tie = new THREE.Mesh(new THREE.TorusGeometry(0.02, 0.006, 6, 12), paint("#ff5d8f", 0.4));
        tie.rotation.x = Math.PI / 2;
        ponytail.add(tie);
        head.add(ponytail);
        break;
      }
      case "beanie": {
        const beanie = this.hairShell(0.112, 0.56, MATERIALS.fabric(hatColor), 0.02);
        beanie.position.set(0, 0.13, -0.004);
        beanie.scale.y = 1.12;
        head.add(beanie);
        const fold = new THREE.Mesh(new THREE.TorusGeometry(0.093, 0.016, 8, 28), MATERIALS.fabric(hatColor));
        fold.rotation.x = Math.PI / 2;
        fold.scale.set(0.86, 1.04, 1);
        fold.position.y = 0.155;
        head.add(fold);
        break;
      }
      case "buns": {
        head.add(shell);
        for (const x of [-0.055, 0.055]) {
          const bun = this.hairShell(0.04, 1, hair, 0.03);
          bun.position.set(x, 0.225, -0.02);
          head.add(bun);
        }
        break;
      }
      case "spiky": {
        const crop = this.hairShell(0.108, 0.5, hair, 0.05);
        crop.position.set(0, 0.13, -0.004);
        head.add(crop);
        break;
      }
      case "afroPuff": {
        head.add(shell);
        const puff = this.hairShell(0.085, 1, hair, 0.06);
        puff.position.set(0, 0.215, -0.04);
        head.add(puff);
        break;
      }
    }
    switch (look.accessory) {
      case "headphones": {
        const band = new THREE.Mesh(new THREE.TorusGeometry(0.1, 0.009, 8, 24, Math.PI), MATERIALS.plastic("#1b1b1b"));
        band.position.y = 0.12;
        head.add(band);
        for (const side of [-1, 1]) {
          const cup = new THREE.Mesh(
            new THREE.CylinderGeometry(0.035, 0.035, 0.03, 18),
            MATERIALS.plastic(look.palette.topAccent === "#2b2b2b" ? "#e2432f" : look.palette.topAccent),
          );
          cup.rotation.z = Math.PI / 2;
          cup.position.set(side * 0.09, 0.105, 0);
          head.add(cup);
        }
        break;
      }
      case "goggles": {
        const strap = new THREE.Mesh(new THREE.TorusGeometry(0.1, 0.008, 6, 28), MATERIALS.fabric("#1b1b1b"));
        strap.rotation.x = Math.PI / 2 - 0.25;
        strap.scale.set(0.84, 1.04, 1);
        strap.position.y = 0.18;
        head.add(strap);
        for (const x of [-0.032, 0.032]) {
          const lens = new THREE.Mesh(new THREE.CylinderGeometry(0.024, 0.024, 0.02, 18), MATERIALS.glass());
          lens.rotation.x = Math.PI / 2 - 0.3;
          lens.position.set(x, 0.19, 0.088);
          head.add(lens);
        }
        break;
      }
      case "headband": {
        const band = new THREE.Mesh(new THREE.TorusGeometry(0.095, 0.011, 6, 28), MATERIALS.fabric(look.palette.hat));
        band.rotation.x = Math.PI / 2 - 0.1;
        band.scale.set(0.85, 1.05, 1);
        band.position.y = 0.17;
        head.add(band);
        break;
      }
      default:
        break;
    }
    return ponytail;
  }

  private buildArm(chest: THREE.Group, side: -1 | 1, sleeve: THREE.Material, skin: THREE.Material, look: HumanLook): void {
    const suffix = side < 0 ? "L" : "R";
    const shoulder = pivot(side * 0.178, 0.225, 0);
    chest.add(shoulder);
    this.joints[`shoulder${suffix}`] = shoulder;
    const cap = sphere(0.05, sleeve);
    cap.scale.set(1.05, 0.8, 0.9);
    shoulder.add(cap);
    shoulder.add(limb(UPPER_ARM, [0.055, 0.056, 0.05, 0.045, 0.043], sleeve));
    const elbow = pivot(0, -UPPER_ARM, 0);
    shoulder.add(elbow);
    this.joints[`elbow${suffix}`] = elbow;
    elbow.add(sphere(0.041, sleeve));
    elbow.add(limb(FOREARM, [0.043, 0.042, 0.037, 0.032, 0.036], sleeve));
    const cuff = new THREE.Mesh(new THREE.CylinderGeometry(0.037, 0.035, 0.03, 14), MATERIALS.fabric(look.palette.topAccent));
    cuff.position.y = -FOREARM + 0.01;
    elbow.add(cuff);
    const hand = pivot(0, -FOREARM - 0.01, 0);
    elbow.add(hand);
    this.joints[`hand${suffix}`] = hand;
    // Loose fist: palm, four curled fingers and a thumb.
    const palm = new THREE.Mesh(new THREE.BoxGeometry(0.075, 0.085, 0.03), skin);
    palm.position.y = -0.045;
    hand.add(palm);
    for (let f = 0; f < 4; f++) {
      const finger = new THREE.Mesh(new THREE.CapsuleGeometry(0.0085, 0.035, 3, 6), skin);
      finger.position.set(-0.027 + f * 0.018, -0.095, 0.012);
      finger.rotation.x = 0.9;
      hand.add(finger);
    }
    const thumb = new THREE.Mesh(new THREE.CapsuleGeometry(0.01, 0.035, 3, 6), skin);
    thumb.position.set(side * -0.04, -0.05, 0.018);
    thumb.rotation.set(0.5, 0, side * 0.6);
    hand.add(thumb);
  }

  private buildLeg(pelvis: THREE.Group, side: -1 | 1, pants: THREE.Material, palette: CharacterPalette): void {
    const suffix = side < 0 ? "L" : "R";
    const hip = pivot(side * 0.09, -0.02, 0);
    pelvis.add(hip);
    this.joints[`hip${suffix}`] = hip;
    hip.add(limb(THIGH, [0.085, 0.088, 0.078, 0.068, 0.058, 0.055], pants, 0.95));
    const knee = pivot(0, -THIGH, 0);
    hip.add(knee);
    this.joints[`knee${suffix}`] = knee;
    knee.add(sphere(0.053, pants));
    knee.add(limb(SHIN, [0.055, 0.057, 0.05, 0.043, 0.042], pants, 0.95));
    const ankle = pivot(0, -SHIN, 0.0);
    knee.add(ankle);
    this.joints[`ankle${suffix}`] = ankle;
    this.buildShoe(ankle, palette);
  }

  /** Sneaker: shaped upper, contrasting midsole, rubber outsole and lace panel. */
  private buildShoe(ankle: THREE.Group, palette: CharacterPalette): void {
    const upper = new THREE.MeshPhysicalMaterial({ color: palette.shoes, roughness: 0.55, clearcoat: 0.2 });
    this.shoeMaterials.push(upper);
    const outline = new THREE.Shape();
    outline.moveTo(-0.045, 0);
    outline.lineTo(0.2, 0);
    outline.quadraticCurveTo(0.24, 0.005, 0.235, 0.04);
    outline.quadraticCurveTo(0.2, 0.075, 0.1, 0.085);
    outline.lineTo(0.02, 0.11);
    outline.quadraticCurveTo(-0.05, 0.11, -0.055, 0.06);
    outline.closePath();
    const geometry = new THREE.ExtrudeGeometry(outline, { depth: 0.09, bevelEnabled: true, bevelSize: 0.012, bevelThickness: 0.012, bevelSegments: 3 });
    geometry.translate(0, 0, -0.045);
    geometry.rotateY(-Math.PI / 2);
    const shoe = new THREE.Mesh(geometry, upper);
    shoe.position.set(0, -0.085, -0.01);
    ankle.add(shoe);
    const sole = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.028, 0.29), MATERIALS.plastic(palette.shoesAccent));
    sole.position.set(0, -0.1, 0.085);
    ankle.add(sole);
    const tread = new THREE.Mesh(new THREE.BoxGeometry(0.098, 0.01, 0.285), MATERIALS.rubber());
    tread.position.set(0, -0.118, 0.085);
    ankle.add(tread);
    const laces = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.012, 0.09), MATERIALS.fabric("#f2f2f2"));
    laces.position.set(0, -0.005, 0.07);
    laces.rotation.x = -0.35;
    ankle.add(laces);
  }

  private buildJetpack(): THREE.Group {
    const group = new THREE.Group();
    group.position.set(0, 0.05, -0.15);
    for (const x of [-0.08, 0.08]) {
      const tank = new THREE.Mesh(new THREE.CapsuleGeometry(0.06, 0.26, 6, 14), MATERIALS.steel("#c9ced4", 0.25));
      tank.position.set(x, 0, -0.03);
      group.add(tank);
      const nozzle = new THREE.Mesh(new THREE.ConeGeometry(0.05, 0.08, 14, 1, true), MATERIALS.darkMetal());
      nozzle.rotation.x = Math.PI;
      nozzle.position.set(x, -0.21, -0.03);
      group.add(nozzle);
      const flame = new THREE.Mesh(new THREE.ConeGeometry(0.045, 0.4, 12), emissive("#ff9a2e", 1.6));
      flame.rotation.x = Math.PI;
      flame.position.set(x, -0.44, -0.03);
      group.add(flame);
      this.flames.push(flame);
    }
    const frame = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.08, 0.05), MATERIALS.darkMetal());
    frame.position.z = 0.02;
    group.add(frame);
    return group;
  }

  private buildMagnet(): THREE.Group {
    const group = new THREE.Group();
    const arc = new THREE.Mesh(new THREE.TorusGeometry(0.06, 0.022, 10, 18, Math.PI), MATERIALS.trainPaint("#c8231d"));
    arc.rotation.x = Math.PI;
    arc.position.y = -0.1;
    group.add(arc);
    for (const x of [-0.06, 0.06]) {
      const tip = new THREE.Mesh(new THREE.CylinderGeometry(0.023, 0.023, 0.04, 12), MATERIALS.steel("#e5e8eb", 0.2));
      tip.position.set(x, -0.12, 0);
      group.add(tip);
    }
    return group;
  }
}

/** German-shepherd-like guard dog with a trotting gait. */
export class DogModel {
  readonly root = new THREE.Group();
  private readonly legs: { hip: THREE.Group; knee: THREE.Group; phase: number }[] = [];
  private readonly tail: THREE.Group;
  private readonly head: THREE.Group;
  private phase = 0;

  constructor() {
    const tan = MATERIALS.fabric("#a8743f");
    const dark = MATERIALS.fabric("#2a211b");
    const body = limb(0.72, [0.1, 0.16, 0.17, 0.155, 0.13, 0.1], tan, 0.85);
    body.rotation.x = -Math.PI / 2;
    body.position.set(0, 0.55, 0.36);
    this.root.add(body);
    const saddle = limb(0.46, [0.1, 0.165, 0.17, 0.14], dark, 0.8);
    saddle.rotation.x = -Math.PI / 2;
    saddle.scale.set(1.04, 1, 0.75);
    saddle.position.set(0, 0.6, 0.22);
    this.root.add(saddle);
    const neck = limb(0.22, [0.09, 0.1, 0.085], tan, 0.9);
    neck.rotation.x = -2.3;
    neck.position.set(0, 0.6, 0.35);
    this.root.add(neck);
    this.head = pivot(0, 0.8, 0.46);
    this.root.add(this.head);
    const skull = sphere(0.085, tan);
    skull.scale.set(0.9, 0.85, 1.05);
    this.head.add(skull);
    const muzzle = limb(0.15, [0.05, 0.048, 0.035, 0.028], dark, 0.85);
    muzzle.rotation.x = -Math.PI / 2 - 0.15;
    muzzle.position.set(0, -0.02, 0.05);
    this.head.add(muzzle);
    const nose = sphere(0.02, MATERIALS.leather("#0d0d0d"));
    nose.position.set(0, -0.03, 0.2);
    this.head.add(nose);
    for (const x of [-0.045, 0.045]) {
      const ear = new THREE.Mesh(new THREE.ConeGeometry(0.035, 0.1, 4), dark);
      ear.position.set(x, 0.09, -0.01);
      ear.rotation.z = x > 0 ? -0.2 : 0.2;
      this.head.add(ear);
      const eye = sphere(0.009, MATERIALS.iris("#2a1a0a"));
      eye.position.set(x * 0.8, 0.02, 0.075);
      this.head.add(eye);
    }
    const positions: [number, number, number][] = [
      [-0.08, 0.2, 0],
      [0.08, 0.2, Math.PI],
      [-0.08, -0.25, Math.PI],
      [0.08, -0.25, 0],
    ];
    for (const [x, z, phase] of positions) {
      const hip = pivot(x, 0.5, z + 0.3);
      hip.add(limb(0.22, [0.045, 0.04, 0.03], tan));
      const knee = pivot(0, -0.22, 0);
      knee.add(limb(0.24, [0.03, 0.025, 0.022], dark));
      const paw = sphere(0.03, dark);
      paw.scale.set(1, 0.6, 1.3);
      paw.position.set(0, -0.24, 0.02);
      knee.add(paw);
      hip.add(knee);
      this.root.add(hip);
      this.legs.push({ hip, knee, phase });
    }
    this.tail = pivot(0, 0.58, -0.36);
    const tailMesh = limb(0.34, [0.03, 0.045, 0.04, 0.02], tan);
    tailMesh.rotation.x = 2.5;
    this.tail.add(tailMesh);
    this.root.add(this.tail);
    this.root.traverse((object) => {
      if (object instanceof THREE.Mesh) object.castShadow = true;
    });
  }

  update(dt: number, speed: number): void {
    this.phase += dt * (5 + speed * 0.35);
    for (const leg of this.legs) {
      const s = Math.sin(this.phase + leg.phase);
      leg.hip.rotation.x = s * 0.7;
      leg.knee.rotation.x = Math.max(0, -Math.cos(this.phase + leg.phase)) * 1.1;
    }
    this.tail.rotation.z = Math.sin(this.phase * 1.7) * 0.35;
    this.head.rotation.x = Math.sin(this.phase * 2) * 0.05;
    this.root.position.y = Math.abs(Math.sin(this.phase)) * 0.04;
  }
}
