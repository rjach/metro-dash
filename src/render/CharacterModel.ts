import * as THREE from "three";
import type { Accessory, CharacterPalette, HairStyle } from "../content/characters";
import { damp } from "../core/math";
import type { PlayerMotion } from "../game/types";
import { curved } from "./curve";
import { emissive, lambert, phong, toon } from "./materials";

export type CharacterStyle = HairStyle | "guardCap";
export type CharacterAccessory = Accessory | "mustache";

export interface CharacterLook {
  palette: CharacterPalette;
  hairStyle: CharacterStyle;
  accessory: CharacterAccessory;
}

export interface AnimationInput {
  motion: PlayerMotion;
  speed: number;
  /** Lateral velocity (m/s), used to lean into lane changes. */
  lateralVelocity: number;
  verticalVelocity: number;
  riding: boolean;
  /** 0..1 progress through a roll. */
  rollProgress: number;
  timeInMotion: number;
}

/** Joint pivots of the procedural rig. */
interface Rig {
  body: THREE.Group;
  torso: THREE.Group;
  head: THREE.Group;
  shoulderL: THREE.Group;
  shoulderR: THREE.Group;
  elbowL: THREE.Group;
  elbowR: THREE.Group;
  hipL: THREE.Group;
  hipR: THREE.Group;
  kneeL: THREE.Group;
  kneeR: THREE.Group;
  handR: THREE.Group;
  back: THREE.Group;
  ponytail?: THREE.Object3D;
}

interface Pose {
  bodyY: number;
  bodyPitch: number;
  bodyRoll: number;
  bodyYaw: number;
  torsoPitch: number;
  torsoYaw: number;
  headPitch: number;
  shoulderL: number;
  shoulderR: number;
  shoulderSpreadL: number;
  shoulderSpreadR: number;
  elbowL: number;
  elbowR: number;
  hipL: number;
  hipR: number;
  hipSpread: number;
  kneeL: number;
  kneeR: number;
}

const HIP_HEIGHT = 0.8;

const capsule = (radius: number, length: number, material: THREE.Material) => new THREE.Mesh(new THREE.CapsuleGeometry(radius, length, 4, 10), material);

const sphere = (radius: number, material: THREE.Material, widthSegments = 16, heightSegments = 12) =>
  new THREE.Mesh(new THREE.SphereGeometry(radius, widthSegments, heightSegments), material);

const pivot = (x: number, y: number, z = 0) => {
  const group = new THREE.Group();
  group.position.set(x, y, z);
  return group;
};

/**
 * Procedurally built, procedurally animated cartoon character. The same rig
 * drives the playable runners and the chasing guard, so every character
 * shares one animation system.
 */
export class CharacterModel {
  readonly root = new THREE.Group();
  private readonly rig: Rig;
  private readonly pose: Pose;
  private runPhase = 0;
  private readonly shoeMaterials: THREE.MeshToonMaterial[] = [];
  private readonly jetpack: THREE.Group;
  private readonly jetFlames: THREE.Mesh[] = [];
  private readonly magnetProp: THREE.Group;
  private lastMotion: PlayerMotion = "idle";
  /** Landing squash: a damped spring kicked when the runner touches down. */
  private squash = 0;
  private squashVelocity = 0;

  constructor(look: CharacterLook, scale = 1) {
    this.rig = this.build(look);
    this.root.add(this.rig.body);
    this.root.scale.setScalar(scale);
    this.pose = this.neutralPose();
    this.jetpack = this.buildJetpack();
    this.jetpack.visible = false;
    this.rig.back.add(this.jetpack);
    this.magnetProp = this.buildMagnetProp();
    this.magnetProp.visible = false;
    this.rig.handR.add(this.magnetProp);
  }

  setJetpackVisible(visible: boolean): void {
    this.jetpack.visible = visible;
  }

  setMagnetVisible(visible: boolean): void {
    this.magnetProp.visible = visible;
  }

  /** Makes the shoes glow while super sneakers are active. */
  setSneakerGlow(active: boolean): void {
    for (const material of this.shoeMaterials) material.emissive.set(active ? "#2bd46b" : "#000000");
  }

  update(dt: number, input: AnimationInput, time: number): void {
    if ((this.lastMotion === "fall" || this.lastMotion === "jump") && input.motion === "run") this.squashVelocity -= 5;
    this.lastMotion = input.motion;
    const target = this.targetPose(input, time);
    const sharpness = input.motion === "roll" && !input.riding ? 30 : input.motion === "crashed" ? 8 : 16;
    const pose = this.pose;
    // Body pitch is periodic (rolls spin a full turn); wrap it so blending never unwinds backwards.
    pose.bodyPitch = Math.atan2(Math.sin(pose.bodyPitch), Math.cos(pose.bodyPitch));
    for (const key of Object.keys(pose) as (keyof Pose)[]) pose[key] = damp(pose[key], target[key], sharpness, dt);
    if (input.motion === "roll" && !input.riding) pose.bodyPitch = target.bodyPitch;
    this.squashVelocity += (-this.squash * 220 - this.squashVelocity * 16) * dt;
    this.squash += this.squashVelocity * dt;
    this.apply(input, dt);
    for (const flame of this.jetFlames) flame.scale.y = 0.8 + Math.random() * 0.6;
  }

  // ─── Pose targets ────────────────────────────────────────────────────────

  private neutralPose(): Pose {
    return {
      bodyY: HIP_HEIGHT,
      bodyPitch: 0,
      bodyRoll: 0,
      bodyYaw: 0,
      torsoPitch: 0,
      torsoYaw: 0,
      headPitch: 0,
      shoulderL: 0,
      shoulderR: 0,
      shoulderSpreadL: 0.12,
      shoulderSpreadR: -0.12,
      elbowL: 0.2,
      elbowR: 0.2,
      hipL: 0,
      hipR: 0,
      hipSpread: 0,
      kneeL: 0,
      kneeR: 0,
    };
  }

  private targetPose(input: AnimationInput, time: number): Pose {
    const pose = this.neutralPose();
    const lean = THREE.MathUtils.clamp(-input.lateralVelocity * 0.035, -0.45, 0.45);

    if (input.riding && input.motion !== "crashed" && input.motion !== "jetpack" && input.motion !== "stumble") return this.ridePose(pose, input, lean, time);

    switch (input.motion) {
      case "idle": {
        const breathe = Math.sin(time * 2) * 0.02;
        pose.bodyY = HIP_HEIGHT + breathe * 0.5;
        pose.torsoPitch = -0.04 + breathe;
        pose.headPitch = Math.sin(time * 0.7) * 0.08;
        pose.shoulderSpreadL = 0.2;
        pose.shoulderSpreadR = -0.2;
        pose.elbowL = 0.35 + breathe * 2;
        pose.elbowR = 0.35 - breathe * 2;
        pose.hipSpread = 0.08;
        pose.bodyRoll = Math.sin(time * 0.9) * 0.03;
        return pose;
      }
      case "run": {
        const phase = this.runPhase;
        const swing = Math.sin(phase);
        const amplitude = 0.95;
        pose.bodyY = HIP_HEIGHT - 0.02 + Math.abs(Math.cos(phase)) * 0.07;
        pose.torsoPitch = 0.22;
        pose.torsoYaw = swing * 0.18;
        pose.bodyRoll = lean;
        pose.hipL = swing * amplitude;
        pose.hipR = -swing * amplitude;
        pose.kneeL = Math.max(0, -Math.cos(phase)) * 1.5 + 0.15;
        pose.kneeR = Math.max(0, Math.cos(phase)) * 1.5 + 0.15;
        pose.shoulderL = -swing * 0.95;
        pose.shoulderR = swing * 0.95;
        pose.elbowL = 1.4;
        pose.elbowR = 1.4;
        pose.shoulderSpreadL = 0.18;
        pose.shoulderSpreadR = -0.18;
        return pose;
      }
      case "jump":
      case "fall": {
        const rising = input.verticalVelocity > 0;
        pose.bodyY = HIP_HEIGHT + 0.05;
        pose.torsoPitch = rising ? 0.1 : 0.25;
        pose.bodyRoll = lean;
        pose.hipL = rising ? -1.3 : -0.4;
        pose.hipR = rising ? -0.2 : 0.3;
        pose.kneeL = rising ? 1.9 : 0.6;
        pose.kneeR = rising ? 0.9 : 0.4;
        pose.shoulderL = rising ? -2.6 : -1.2;
        pose.shoulderR = rising ? 0.6 : -1.2;
        pose.shoulderSpreadL = 0.4;
        pose.shoulderSpreadR = -0.7;
        pose.elbowL = 0.4;
        pose.elbowR = 0.8;
        return pose;
      }
      case "roll": {
        pose.bodyY = 0.5;
        pose.bodyPitch = input.rollProgress * Math.PI * 2;
        pose.torsoPitch = 0.9;
        pose.headPitch = 0.5;
        pose.hipL = -2.1;
        pose.hipR = -2.1;
        pose.kneeL = 2.4;
        pose.kneeR = 2.4;
        pose.shoulderL = -1.2;
        pose.shoulderR = -1.2;
        pose.shoulderSpreadL = 0.1;
        pose.shoulderSpreadR = -0.1;
        pose.elbowL = 2;
        pose.elbowR = 2;
        return pose;
      }
      case "jetpack": {
        const sway = Math.sin(time * 5) * 0.05;
        pose.bodyY = HIP_HEIGHT;
        pose.bodyPitch = 0.35;
        pose.bodyRoll = lean * 1.4;
        pose.torsoPitch = 0.1;
        pose.headPitch = -0.3;
        pose.hipL = 0.35 + sway;
        pose.hipR = 0.2 - sway;
        pose.kneeL = 0.7;
        pose.kneeR = 0.9;
        pose.shoulderL = -0.4;
        pose.shoulderR = -0.4;
        pose.shoulderSpreadL = 0.3;
        pose.shoulderSpreadR = -0.3;
        pose.elbowL = 1.6;
        pose.elbowR = 1.6;
        return pose;
      }
      case "stumble": {
        const wobble = Math.sin(input.timeInMotion * 22) * 0.4;
        pose.bodyY = HIP_HEIGHT - 0.05;
        pose.torsoPitch = -0.35;
        pose.bodyRoll = wobble * 0.4;
        pose.headPitch = -0.3;
        pose.shoulderL = -2.4 + wobble;
        pose.shoulderR = -2.4 - wobble;
        pose.shoulderSpreadL = 0.9;
        pose.shoulderSpreadR = -0.9;
        pose.hipL = 0.6;
        pose.hipR = -0.4;
        pose.kneeL = 0.6;
        pose.kneeR = 0.3;
        return pose;
      }
      case "crashed": {
        pose.bodyY = 0.3;
        pose.bodyPitch = -1.35;
        pose.torsoPitch = -0.2;
        pose.headPitch = -0.2;
        pose.shoulderL = -2.8;
        pose.shoulderR = -2.8;
        pose.shoulderSpreadL = 1.2;
        pose.shoulderSpreadR = -1.2;
        pose.hipL = -0.6;
        pose.hipR = -0.2;
        pose.kneeL = 0.5;
        pose.kneeR = 0.2;
        return pose;
      }
    }
  }

  /**
   * Surf stance on the hoverboard. "Down" is a deep tuck grabbing the board's
   * edge (instead of the on-foot roll), so the board stays under the feet.
   */
  private ridePose(pose: Pose, input: AnimationInput, lean: number, time: number): Pose {
    const sway = Math.sin(time * 2.6) * 0.06;
    const crouch = input.motion === "roll";
    const airborne = input.motion === "jump" || input.motion === "fall";
    pose.bodyYaw = 0.5;
    pose.bodyRoll = lean * 1.3 + sway;
    pose.torsoYaw = -0.4;
    pose.hipSpread = 0.18;
    if (crouch) {
      pose.bodyY = HIP_HEIGHT - 0.34;
      pose.torsoPitch = 0.75;
      pose.headPitch = -0.45;
      pose.hipL = -1.45;
      pose.hipR = -1.1;
      pose.kneeL = 2.1;
      pose.kneeR = 1.9;
      // Trailing hand grabs the deck; leading arm out for balance.
      pose.shoulderR = -0.9;
      pose.shoulderSpreadR = -0.15;
      pose.elbowR = 0.2;
      pose.shoulderL = -0.4;
      pose.shoulderSpreadL = 1.1;
      pose.elbowL = 0.5;
      return pose;
    }
    pose.bodyY = HIP_HEIGHT - (airborne ? 0.16 : 0.08);
    pose.torsoPitch = 0.25;
    pose.hipL = airborne ? -0.9 : -0.5;
    pose.hipR = airborne ? -0.2 : 0.35;
    pose.kneeL = airborne ? 1.3 : 0.9;
    pose.kneeR = airborne ? 1.1 : 0.7;
    pose.shoulderL = -0.3;
    pose.shoulderR = 0.2;
    pose.shoulderSpreadL = 1.1;
    pose.shoulderSpreadR = -1.1;
    pose.elbowL = 0.4;
    pose.elbowR = 0.4;
    return pose;
  }

  private apply(input: AnimationInput, dt: number): void {
    const rig = this.rig;
    const pose = this.pose;
    if (input.motion === "run" && !input.riding) {
      const cadence = 1.6 + input.speed * 0.075;
      this.runPhase += dt * cadence * Math.PI * 2 * 0.5;
    }
    const squash = Math.min(0, this.squash);
    rig.body.position.y = pose.bodyY + squash * 0.18;
    rig.body.rotation.set(pose.bodyPitch, pose.bodyYaw, pose.bodyRoll, "YXZ");
    rig.body.scale.set(1 - squash * 0.12, 1 + squash * 0.12, 1 - squash * 0.12);
    rig.torso.rotation.set(pose.torsoPitch, pose.torsoYaw, 0);
    rig.head.rotation.x = pose.headPitch - pose.torsoPitch * 0.5;
    rig.shoulderL.rotation.set(pose.shoulderL, 0, pose.shoulderSpreadL);
    rig.shoulderR.rotation.set(pose.shoulderR, 0, pose.shoulderSpreadR);
    rig.elbowL.rotation.x = -pose.elbowL;
    rig.elbowR.rotation.x = -pose.elbowR;
    rig.hipL.rotation.set(pose.hipL, 0, pose.hipSpread);
    rig.hipR.rotation.set(pose.hipR, 0, -pose.hipSpread);
    rig.kneeL.rotation.x = pose.kneeL;
    rig.kneeR.rotation.x = pose.kneeR;
    if (rig.ponytail) rig.ponytail.rotation.x = 0.4 + Math.sin(this.runPhase * 2) * 0.25 + pose.torsoPitch;
  }

  // ─── Construction ────────────────────────────────────────────────────────

  private build(look: CharacterLook): Rig {
    const { palette } = look;
    const skin = toon(palette.skin);
    const top = toon(palette.top);
    const accent = toon(palette.topAccent);
    const bottom = toon(palette.bottom);
    const shoe = curved(new THREE.MeshToonMaterial({ color: palette.shoes }));
    this.shoeMaterials.push(shoe);
    const shoeAccent = toon(palette.shoesAccent);

    const body = pivot(0, HIP_HEIGHT);
    const pelvis = capsule(0.17, 0.12, bottom);
    pelvis.rotation.z = Math.PI / 2;
    pelvis.position.y = 0.02;
    body.add(pelvis);

    const torso = pivot(0, 0.06);
    body.add(torso);
    const chest = capsule(0.21, 0.26, top);
    chest.scale.set(1.08, 1, 0.82);
    chest.position.y = 0.26;
    torso.add(chest);
    const pocket = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.1, 0.05), accent);
    pocket.position.set(0, 0.18, 0.17);
    torso.add(pocket);
    const collar = new THREE.Mesh(new THREE.TorusGeometry(0.12, 0.04, 6, 14), accent);
    collar.rotation.x = Math.PI / 2;
    collar.position.y = 0.5;
    torso.add(collar);

    const back = pivot(0, 0.28, -0.18);
    torso.add(back);

    const head = pivot(0, 0.56);
    torso.add(head);
    const skull = sphere(0.23, skin, 20, 16);
    skull.scale.set(1, 1.05, 0.98);
    skull.position.y = 0.2;
    head.add(skull);
    this.addFace(head, look);
    const ponytail = this.addHair(head, look);

    const makeArm = (side: -1 | 1) => {
      const shoulder = pivot(side * 0.27, 0.43);
      torso.add(shoulder);
      const upper = capsule(0.075, 0.2, top);
      upper.position.y = -0.14;
      shoulder.add(upper);
      const elbow = pivot(0, -0.3);
      shoulder.add(elbow);
      const fore = capsule(0.065, 0.18, skin);
      fore.position.y = -0.12;
      elbow.add(fore);
      const cuff = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 0.06, 10), accent);
      cuff.position.y = -0.01;
      elbow.add(cuff);
      const hand = pivot(0, -0.27);
      elbow.add(hand);
      hand.add(sphere(0.075, skin, 10, 8));
      return { shoulder, elbow, hand };
    };
    const armL = makeArm(-1);
    const armR = makeArm(1);

    const makeLeg = (side: -1 | 1) => {
      const hip = pivot(side * 0.1, -0.02);
      body.add(hip);
      const thigh = capsule(0.095, 0.22, bottom);
      thigh.position.y = -0.18;
      hip.add(thigh);
      const knee = pivot(0, -0.38);
      hip.add(knee);
      const shin = capsule(0.085, 0.2, bottom);
      shin.position.y = -0.16;
      knee.add(shin);
      const foot = new THREE.Group();
      foot.position.set(0, -0.36, 0.04);
      knee.add(foot);
      const shoeMesh = capsule(0.1, 0.16, shoe);
      shoeMesh.rotation.x = Math.PI / 2;
      shoeMesh.scale.set(1.1, 1, 0.9);
      foot.add(shoeMesh);
      const sole = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.05, 0.36), shoeAccent);
      sole.position.set(0, -0.08, 0);
      foot.add(sole);
      const stripe = new THREE.Mesh(new THREE.BoxGeometry(0.21, 0.03, 0.12), shoeAccent);
      stripe.position.set(0, 0.02, 0.04);
      foot.add(stripe);
      return { hip, knee };
    };
    const legL = makeLeg(-1);
    const legR = makeLeg(1);

    if (look.accessory === "backpack") {
      const pack = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.38, 0.16), toon(palette.hat));
      pack.position.set(0, 0, -0.02);
      back.add(pack);
    }

    return {
      body,
      torso,
      head,
      shoulderL: armL.shoulder,
      shoulderR: armR.shoulder,
      elbowL: armL.elbow,
      elbowR: armR.elbow,
      handR: armR.hand,
      hipL: legL.hip,
      hipR: legR.hip,
      kneeL: legL.knee,
      kneeR: legR.knee,
      back,
      ...(ponytail ? { ponytail } : {}),
    };
  }

  private addFace(head: THREE.Group, look: CharacterLook): void {
    const white = lambert("#ffffff");
    const pupil = lambert("#1b1b2f");
    const shine = emissive("#ffffff");
    for (const x of [-0.085, 0.085]) {
      const eye = sphere(0.055, white, 12, 10);
      eye.scale.set(0.85, 1.1, 0.5);
      eye.position.set(x, 0.23, 0.2);
      head.add(eye);
      const iris = sphere(0.032, pupil, 10, 8);
      iris.position.set(x, 0.225, 0.228);
      head.add(iris);
      // Catch-light makes the eyes read alive from across the screen.
      const glint = sphere(0.009, shine, 6, 4);
      glint.position.set(x + 0.012, 0.24, 0.255);
      head.add(glint);
      const brow = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.018, 0.02), toon(look.palette.hair));
      brow.position.set(x, 0.3, 0.215);
      brow.rotation.z = x > 0 ? -0.15 : 0.15;
      head.add(brow);
    }
    const mouth = new THREE.Mesh(new THREE.TorusGeometry(0.045, 0.012, 6, 12, Math.PI), lambert("#7a2e2e"));
    mouth.position.set(0, 0.13, 0.215);
    mouth.rotation.z = Math.PI;
    head.add(mouth);
    const nose = sphere(0.025, toon(look.palette.skin), 8, 6);
    nose.position.set(0, 0.18, 0.23);
    head.add(nose);
    for (const x of [-0.235, 0.235]) {
      const ear = sphere(0.05, toon(look.palette.skin), 8, 6);
      ear.scale.set(0.5, 1, 0.8);
      ear.position.set(x, 0.2, 0);
      head.add(ear);
    }
    if (look.accessory === "mustache") {
      const stache = capsule(0.028, 0.12, lambert("#3b2a1f"));
      stache.rotation.z = Math.PI / 2;
      stache.position.set(0, 0.155, 0.225);
      head.add(stache);
    }
  }

  private addHair(head: THREE.Group, look: CharacterLook): THREE.Object3D | null {
    const { palette } = look;
    const hair = toon(palette.hair);
    const hat = toon(palette.hat);
    const cap = sphere(0.24, hair, 20, 12);
    cap.scale.set(1.02, 0.75, 1.02);
    cap.position.set(0, 0.28, -0.02);
    let ponytail: THREE.Object3D | null = null;

    switch (look.hairStyle) {
      case "capBack":
      case "guardCap": {
        head.add(cap);
        const dome = new THREE.Mesh(new THREE.SphereGeometry(0.25, 20, 10, 0, Math.PI * 2, 0, Math.PI / 2), hat);
        dome.position.y = 0.27;
        head.add(dome);
        const visor = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, 0.03, 16, 1, false, 0, Math.PI), hat);
        const facing = look.hairStyle === "guardCap" ? 1 : -1;
        visor.position.set(0, 0.28, facing * 0.2);
        visor.rotation.y = facing > 0 ? -Math.PI / 2 : Math.PI / 2;
        visor.scale.set(1, 1, 0.9);
        head.add(visor);
        if (look.hairStyle === "guardCap") {
          const badge = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.07, 0.02), phong("#ffd23f", 90));
          badge.position.set(0, 0.36, 0.24);
          head.add(badge);
        }
        break;
      }
      case "ponytail": {
        head.add(cap);
        const tail = new THREE.Group();
        tail.position.set(0, 0.36, -0.2);
        const strand = capsule(0.07, 0.26, hair);
        strand.position.y = -0.16;
        tail.add(strand);
        head.add(tail);
        ponytail = tail;
        break;
      }
      case "beanie": {
        const beanie = new THREE.Mesh(new THREE.SphereGeometry(0.255, 20, 12, 0, Math.PI * 2, 0, Math.PI * 0.55), hat);
        beanie.scale.set(1, 1.15, 1);
        beanie.position.y = 0.24;
        head.add(beanie);
        const fold = new THREE.Mesh(new THREE.TorusGeometry(0.24, 0.05, 8, 20), hat);
        fold.rotation.x = Math.PI / 2;
        fold.position.y = 0.28;
        head.add(fold);
        const pom = sphere(0.07, toon(palette.topAccent), 10, 8);
        pom.position.y = 0.55;
        head.add(pom);
        break;
      }
      case "buns": {
        head.add(cap);
        for (const x of [-0.16, 0.16]) {
          const bun = sphere(0.1, hair, 12, 10);
          bun.position.set(x, 0.46, -0.02);
          head.add(bun);
        }
        break;
      }
      case "spiky": {
        head.add(cap);
        for (let i = 0; i < 7; i++) {
          const spike = new THREE.Mesh(new THREE.ConeGeometry(0.07, 0.22, 6), hair);
          const angle = (i / 7) * Math.PI - Math.PI / 2;
          spike.position.set(Math.sin(angle) * 0.14, 0.44, -Math.cos(angle) * 0.1 - 0.03);
          spike.rotation.set(-0.5 * Math.cos(angle), 0, -0.6 * Math.sin(angle));
          head.add(spike);
        }
        break;
      }
      case "afroPuff": {
        head.add(cap);
        const puff = sphere(0.2, hair, 14, 12);
        puff.position.set(0, 0.5, -0.1);
        head.add(puff);
        break;
      }
    }

    switch (look.accessory) {
      case "headphones": {
        const band = new THREE.Mesh(new THREE.TorusGeometry(0.26, 0.025, 6, 20, Math.PI), lambert("#222"));
        band.position.y = 0.22;
        head.add(band);
        for (const x of [-0.25, 0.25]) {
          const cup = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 0.06, 12), toon(palette.topAccent === "#2b2b2b" ? "#ff4b3e" : palette.topAccent));
          cup.rotation.z = Math.PI / 2;
          cup.position.set(x, 0.2, 0);
          head.add(cup);
        }
        break;
      }
      case "goggles": {
        const strap = new THREE.Mesh(new THREE.TorusGeometry(0.245, 0.02, 6, 24), lambert("#222"));
        strap.rotation.x = Math.PI / 2;
        strap.position.y = 0.34;
        head.add(strap);
        for (const x of [-0.08, 0.08]) {
          const lens = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.05, 14), phong("#66e3ff", 120));
          lens.rotation.x = Math.PI / 2;
          lens.position.set(x, 0.36, 0.22);
          head.add(lens);
        }
        break;
      }
      case "headband": {
        const band = new THREE.Mesh(new THREE.TorusGeometry(0.235, 0.028, 6, 24), toon(palette.hat));
        band.rotation.x = Math.PI / 2 - 0.15;
        band.position.y = 0.33;
        head.add(band);
        break;
      }
      default:
        break;
    }
    return ponytail;
  }

  private buildJetpack(): THREE.Group {
    const group = new THREE.Group();
    for (const x of [-0.12, 0.12]) {
      const tank = capsule(0.09, 0.28, phong("#ffb300", 70));
      tank.position.set(x, 0, -0.06);
      group.add(tank);
      const flame = new THREE.Mesh(new THREE.ConeGeometry(0.08, 0.45, 8), emissive("#ff9a1f", 1.3));
      flame.rotation.x = Math.PI;
      flame.position.set(x, -0.42, -0.06);
      group.add(flame);
      this.jetFlames.push(flame);
    }
    return group;
  }

  private buildMagnetProp(): THREE.Group {
    const group = new THREE.Group();
    const arc = new THREE.Mesh(new THREE.TorusGeometry(0.12, 0.045, 8, 14, Math.PI), phong("#e6392f", 70));
    arc.position.y = -0.12;
    group.add(arc);
    for (const x of [-0.12, 0.12]) {
      const tip = new THREE.Mesh(new THREE.CylinderGeometry(0.047, 0.047, 0.08, 8), phong("#e9eef2", 100));
      tip.position.set(x, -0.1, 0);
      group.add(tip);
    }
    group.rotation.x = Math.PI;
    return group;
  }
}

/** Simple quadruped companion for the guard. */
export class DogModel {
  readonly root = new THREE.Group();
  private readonly legs: THREE.Group[] = [];
  private readonly tail: THREE.Group;
  private phase = 0;

  constructor() {
    const fur = toon("#b5733a");
    const dark = toon("#5a3a1f");
    const body = capsule(0.17, 0.5, fur);
    body.rotation.x = Math.PI / 2;
    body.position.y = 0.48;
    this.root.add(body);
    const head = sphere(0.16, fur, 12, 10);
    head.position.set(0, 0.68, 0.42);
    this.root.add(head);
    const snout = capsule(0.07, 0.1, fur);
    snout.rotation.x = Math.PI / 2;
    snout.position.set(0, 0.63, 0.58);
    this.root.add(snout);
    const nose = sphere(0.04, lambert("#111"), 8, 6);
    nose.position.set(0, 0.65, 0.66);
    this.root.add(nose);
    for (const x of [-0.1, 0.1]) {
      const ear = new THREE.Mesh(new THREE.ConeGeometry(0.06, 0.14, 4), dark);
      ear.position.set(x, 0.84, 0.38);
      this.root.add(ear);
    }
    for (const [x, z] of [
      [-0.1, 0.25],
      [0.1, 0.25],
      [-0.1, -0.25],
      [0.1, -0.25],
    ] as const) {
      const leg = pivot(x, 0.4, z);
      const mesh = capsule(0.05, 0.22, dark);
      mesh.position.y = -0.16;
      leg.add(mesh);
      this.root.add(leg);
      this.legs.push(leg);
    }
    this.tail = pivot(0, 0.55, -0.4);
    const tailMesh = capsule(0.035, 0.2, fur);
    tailMesh.position.y = 0.12;
    this.tail.add(tailMesh);
    this.tail.rotation.x = -0.7;
    this.root.add(this.tail);
  }

  update(dt: number, speed: number): void {
    this.phase += dt * (6 + speed * 0.3);
    this.legs.forEach((leg, i) => {
      leg.rotation.x = Math.sin(this.phase + (i % 2 === 0 ? 0 : Math.PI) + (i > 1 ? Math.PI / 2 : 0)) * 0.8;
    });
    this.tail.rotation.z = Math.sin(this.phase * 2) * 0.5;
    this.root.position.y = Math.abs(Math.sin(this.phase)) * 0.05;
  }
}
