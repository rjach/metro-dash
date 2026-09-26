// Test-only page: renders a humanoid in scripted poses so the real MediaPipe
// pipeline can be exercised without a physical person in front of a webcam.
import * as THREE from "three";
import { MediaPipePoseEstimator } from "../src/input/camera/PoseEstimator";

const canvas = document.getElementById("c") as HTMLCanvasElement;
const renderer = new THREE.WebGLRenderer({ canvas, preserveDrawingBuffer: true, antialias: true });
renderer.setSize(640, 480, false);
const scene = new THREE.Scene();
scene.background = new THREE.Color("#d8d2c4");
scene.add(new THREE.HemisphereLight("#ffffff", "#666666", 2.2));
const sun = new THREE.DirectionalLight("#ffffff", 1.4);
sun.position.set(1, 3, 4);
scene.add(sun);
const camera = new THREE.PerspectiveCamera(50, 640 / 480, 0.1, 50);
camera.position.set(0, 1.05, 2.6);
camera.lookAt(0, 0.95, 0);

/** Adult-proportioned mannequin (≈7.5 heads tall) — closer to what the pose model was trained on. */
const buildMannequin = () => {
  const skin = new THREE.MeshStandardMaterial({ color: "#d9a07c", roughness: 0.7 });
  const shirt = new THREE.MeshStandardMaterial({ color: "#2e6fd8", roughness: 0.8 });
  const pants = new THREE.MeshStandardMaterial({ color: "#2b2b33", roughness: 0.9 });
  const hair = new THREE.MeshStandardMaterial({ color: "#2a1c14", roughness: 0.9 });
  const dark = new THREE.MeshStandardMaterial({ color: "#111" });
  const white = new THREE.MeshStandardMaterial({ color: "#f5f5f5" });
  const lips = new THREE.MeshStandardMaterial({ color: "#a0524a" });
  const limb = (r: number, len: number, m: THREE.Material) => new THREE.Mesh(new THREE.CapsuleGeometry(r, len, 6, 12), m);
  const joint = (x: number, y: number, z = 0) => {
    const g = new THREE.Group();
    g.position.set(x, y, z);
    return g;
  };
  const root = new THREE.Group();
  const hips = joint(0, 0.95);
  root.add(hips);
  const pelvis = limb(0.15, 0.12, pants);
  pelvis.rotation.z = Math.PI / 2;
  hips.add(pelvis);
  const spine = joint(0, 0.05);
  hips.add(spine);
  const torso = limb(0.17, 0.36, shirt);
  torso.scale.set(1.25, 1, 0.7);
  torso.position.y = 0.3;
  spine.add(torso);
  const neck = limb(0.055, 0.08, skin);
  neck.position.y = 0.62;
  spine.add(neck);
  const head = joint(0, 0.78);
  spine.add(head);
  const skull = new THREE.Mesh(new THREE.SphereGeometry(0.115, 24, 18), skin);
  skull.scale.set(0.85, 1.12, 0.95);
  head.add(skull);
  const cap = new THREE.Mesh(new THREE.SphereGeometry(0.118, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2.2), hair);
  cap.scale.set(0.88, 1.15, 1);
  cap.position.y = 0.012;
  head.add(cap);
  for (const x of [-0.037, 0.037]) {
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.018, 12, 8), white);
    eye.scale.set(1.2, 0.8, 0.5);
    eye.position.set(x, 0.02, 0.1);
    head.add(eye);
    const pupil = new THREE.Mesh(new THREE.SphereGeometry(0.009, 8, 6), dark);
    pupil.position.set(x, 0.02, 0.109);
    head.add(pupil);
    const brow = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.008, 0.01), hair);
    brow.position.set(x, 0.048, 0.103);
    head.add(brow);
  }
  const nose = new THREE.Mesh(new THREE.ConeGeometry(0.014, 0.04, 8), skin);
  nose.rotation.x = Math.PI / 2;
  nose.position.set(0, -0.005, 0.115);
  head.add(nose);
  const mouth = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.008, 0.01), lips);
  mouth.position.set(0, -0.05, 0.1);
  head.add(mouth);
  const arms: { shoulder: THREE.Group; elbow: THREE.Group; side: number }[] = [];
  for (const side of [-1, 1]) {
    const shoulder = joint(side * 0.21, 0.52);
    spine.add(shoulder);
    const upper = limb(0.05, 0.24, shirt);
    upper.position.y = -0.15;
    shoulder.add(upper);
    const elbow = joint(0, -0.3);
    shoulder.add(elbow);
    const fore = limb(0.042, 0.22, skin);
    fore.position.y = -0.13;
    elbow.add(fore);
    const hand = new THREE.Mesh(new THREE.SphereGeometry(0.045, 10, 8), skin);
    hand.position.y = -0.29;
    elbow.add(hand);
    shoulder.rotation.z = side * 0.18;
    arms.push({ shoulder, elbow, side });
    const hip = joint(side * 0.09, -0.02);
    hips.add(hip);
    const thigh = limb(0.07, 0.34, pants);
    thigh.position.y = -0.22;
    hip.add(thigh);
    const knee = joint(0, -0.44);
    hip.add(knee);
    const shin = limb(0.055, 0.34, pants);
    shin.position.y = -0.22;
    knee.add(shin);
    const foot = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.06, 0.22), dark);
    foot.position.set(0, -0.47, 0.05);
    knee.add(foot);
    hip.rotation.z = side * 0.05;
  }
  return { root, spine, arms };
};

const mannequin = buildMannequin();
scene.add(mannequin.root);

export interface PoseCommand {
  x: number;
  y: number;
  lean: number;
  crouch: number;
  handsUp: boolean;
  /** Performer lifts their own left/right hand to chest height. */
  leftRaise?: boolean;
  rightRaise?: boolean;
}

const setPose = (pose: PoseCommand) => {
  // The mannequin faces the camera, so the performer's right is world −x.
  mannequin.root.position.set(-pose.x, pose.y - pose.crouch * 0.42, 0);
  // Lean pivots at the hips, as a person leaning sideways does (+ = toward the performer's right).
  mannequin.spine.rotation.z = pose.lean;
  for (const arm of mannequin.arms) {
    // The mannequin faces the camera, so its own right arm is on the −x side.
    const raised = arm.side < 0 ? pose.rightRaise : pose.leftRaise;
    arm.shoulder.rotation.set(raised ? -1.25 : 0, 0, arm.side * (pose.handsUp ? 2.8 : 0.18));
    arm.elbow.rotation.x = raised ? -1.1 : 0;
  }
  renderer.render(scene, camera);
};

const estimator = new MediaPipePoseEstimator();
let t = 0;
(window as unknown as Record<string, unknown>).harness = {
  ready: estimator.load().then(() => estimator.backend),
  render: (pose: PoseCommand) => {
    setPose(pose);
    return canvas.toDataURL("image/jpeg", 0.9);
  },
  detect: (pose: PoseCommand) => {
    setPose(pose);
    t += 33;
    const landmarks = estimator.estimate(canvas, t);
    return landmarks ? landmarks.map((l) => ({ x: +l.x.toFixed(3), y: +l.y.toFixed(3), v: +(l.visibility ?? 0).toFixed(2) })) : null;
  },
};
