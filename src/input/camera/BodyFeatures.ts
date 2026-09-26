/** MediaPipe Pose landmark indices used by the gesture system. */
export const LANDMARK = {
  nose: 0,
  leftShoulder: 11,
  rightShoulder: 12,
  leftWrist: 15,
  rightWrist: 16,
  leftHip: 23,
  rightHip: 24,
} as const;

export interface Landmark {
  x: number;
  y: number;
  z: number;
  visibility?: number;
}

/**
 * Body measurements in normalised image coordinates, expressed from the
 * player's point of view (x grows toward the player's right, i.e. mirrored).
 */
export interface BodyFeatures {
  centerX: number;
  shoulderY: number;
  hipY: number | null;
  shoulderWidth: number;
  torsoLength: number | null;
  /** Spine tilt in radians; positive when leaning to the player's right. */
  tilt: number | null;
  noseY: number;
  wristsAboveHead: boolean;
  /**
   * Hand heights above the hip line in torso lengths (≈0 hanging relaxed,
   * ≈0.6 at chest, >1 above the shoulders), from the player's point of view.
   * Null when that wrist is not reliably visible.
   */
  leftHandHeight: number | null;
  rightHandHeight: number | null;
  confidence: number;
}

const MIN_VISIBILITY = 0.5;
const visibility = (landmark: Landmark | undefined) => landmark?.visibility ?? 0;

/**
 * Pose models regularly swap the left/right wrist labels from frame to frame
 * (especially for a hand raised toward the camera). Which side of the body a
 * wrist is on is far more reliable than its label, so hands are assigned by
 * position relative to the body's centre line (in the player's mirrored view).
 */
const assignHandsBySide = (
  a: Landmark | undefined,
  b: Landmark | undefined,
  centerX: number,
  heightOf: (wrist: Landmark | undefined) => number | null,
): { leftHandHeight: number | null; rightHandHeight: number | null } => {
  const visible = [a, b].filter((wrist): wrist is Landmark => visibility(wrist) >= MIN_VISIBILITY);
  const sideOf = (wrist: Landmark) => 1 - wrist.x - centerX;
  if (visible.length === 2) {
    const [first, second] = visible as [Landmark, Landmark];
    const [leftWrist, rightWrist] = sideOf(first) <= sideOf(second) ? [first, second] : [second, first];
    return { leftHandHeight: heightOf(leftWrist), rightHandHeight: heightOf(rightWrist) };
  }
  if (visible.length === 1) {
    const wrist = visible[0]!;
    return sideOf(wrist) < 0 ? { leftHandHeight: heightOf(wrist), rightHandHeight: null } : { leftHandHeight: null, rightHandHeight: heightOf(wrist) };
  }
  return { leftHandHeight: null, rightHandHeight: null };
};

/**
 * Extracts stable body features from raw pose landmarks.
 *
 * @param landmarks - 33 pose landmarks in raw (non-mirrored) camera space
 * @returns Features, or null when the upper body is not reliably visible
 */
export const extractFeatures = (landmarks: readonly Landmark[] | null | undefined): BodyFeatures | null => {
  if (!landmarks || landmarks.length < 25) return null;
  const leftShoulder = landmarks[LANDMARK.leftShoulder]!;
  const rightShoulder = landmarks[LANDMARK.rightShoulder]!;
  const shoulderConfidence = Math.min(visibility(leftShoulder), visibility(rightShoulder));
  if (shoulderConfidence < MIN_VISIBILITY) return null;

  const nose = landmarks[LANDMARK.nose]!;
  const leftHip = landmarks[LANDMARK.leftHip]!;
  const rightHip = landmarks[LANDMARK.rightHip]!;
  const hipsVisible = Math.min(visibility(leftHip), visibility(rightHip)) >= MIN_VISIBILITY;

  // Mirror so that "right" means the player's right, matching the on-screen selfie preview.
  const mirror = (x: number) => 1 - x;
  const shoulderX = mirror((leftShoulder.x + rightShoulder.x) / 2);
  const shoulderY = (leftShoulder.y + rightShoulder.y) / 2;
  const shoulderWidth = Math.hypot(leftShoulder.x - rightShoulder.x, leftShoulder.y - rightShoulder.y);
  if (shoulderWidth < 0.02) return null;

  let hipY: number | null = null;
  let torsoLength: number | null = null;
  let tilt: number | null = null;
  let centerX = shoulderX;
  if (hipsVisible) {
    const hipX = mirror((leftHip.x + rightHip.x) / 2);
    hipY = (leftHip.y + rightHip.y) / 2;
    torsoLength = Math.hypot(shoulderX - hipX, hipY - shoulderY);
    tilt = Math.atan2(shoulderX - hipX, hipY - shoulderY);
    // Weight toward the hips: stepping moves them, leaning mostly moves the shoulders (handled by tilt).
    centerX = shoulderX * 0.5 + hipX * 0.5;
  }

  const leftWrist = landmarks[LANDMARK.leftWrist];
  const rightWrist = landmarks[LANDMARK.rightWrist];
  // Torso scale for hand heights; fall back to the typical shoulder-width ratio when hips are hidden.
  const handScale = torsoLength ?? shoulderWidth * 1.35;
  const hipLine = hipY ?? shoulderY + handScale;
  const handHeight = (wrist: Landmark | undefined) => (visibility(wrist) >= MIN_VISIBILITY ? (hipLine - wrist!.y) / handScale : null);

  const wristsAboveHead =
    visibility(leftWrist) >= MIN_VISIBILITY &&
    visibility(rightWrist) >= MIN_VISIBILITY &&
    leftWrist!.y < nose.y - shoulderWidth * 0.2 &&
    rightWrist!.y < nose.y - shoulderWidth * 0.2;

  return {
    centerX,
    shoulderY,
    hipY,
    shoulderWidth,
    torsoLength,
    tilt,
    noseY: nose.y,
    wristsAboveHead,
    ...assignHandsBySide(leftWrist, rightWrist, shoulderX, handHeight),
    confidence: hipsVisible ? Math.min(shoulderConfidence, visibility(leftHip), visibility(rightHip)) : shoulderConfidence * 0.85,
  };
};
