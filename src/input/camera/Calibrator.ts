import type { CalibrationProfile } from "../../persistence/SaveData";
import type { BodyFeatures } from "./BodyFeatures";
import { TORSO_PER_SHOULDER_WIDTH } from "./GestureRecognizer";

export type CalibrationStatus = "no-person" | "too-far" | "too-close" | "off-center-left" | "off-center-right" | "hold-still" | "calibrating" | "done";

export interface CalibrationProgress {
  status: CalibrationStatus;
  /** 0..1 once the player is framed well and holding still. */
  progress: number;
  /** Hips are not visible; gestures still work but lean detection is less precise. */
  hipsHidden: boolean;
  profile: CalibrationProfile | null;
}

interface Sample {
  timeMs: number;
  features: BodyFeatures;
}

const REQUIRED_STILL_MS = 1500;
const STABILITY_WINDOW_MS = 600;
const MAX_JITTER = 0.018;
/** Framing limits in torso lengths (shoulder→hip) relative to the frame height. */
const MIN_TORSO = 0.12;
const MAX_TORSO = 0.5;
const MAX_SHOULDER_WIDTH = 0.55;
const CENTER_TOLERANCE = 0.2;

/**
 * Guides the player into a good neutral stance and captures it as the
 * baseline the GestureRecognizer measures every movement against.
 */
export class Calibrator {
  private samples: Sample[] = [];
  private stillSince: number | null = null;
  private result: CalibrationProfile | null = null;

  reset(): void {
    this.samples = [];
    this.stillSince = null;
    this.result = null;
  }

  update(features: BodyFeatures | null, timeMs: number): CalibrationProgress {
    if (this.result) return { status: "done", progress: 1, hipsHidden: false, profile: this.result };
    if (!features || features.confidence < 0.55) return this.restart("no-person", false);

    const hipsHidden = features.hipY === null;
    const torso = features.torsoLength ?? features.shoulderWidth * TORSO_PER_SHOULDER_WIDTH;
    if (torso < MIN_TORSO) return this.restart("too-far", hipsHidden);
    if (torso > MAX_TORSO || features.shoulderWidth > MAX_SHOULDER_WIDTH) return this.restart("too-close", hipsHidden);
    if (features.centerX < 0.5 - CENTER_TOLERANCE) return this.restart("off-center-left", hipsHidden);
    if (features.centerX > 0.5 + CENTER_TOLERANCE) return this.restart("off-center-right", hipsHidden);

    this.samples.push({ timeMs, features });
    this.samples = this.samples.filter((sample) => timeMs - sample.timeMs <= REQUIRED_STILL_MS + 200);
    const recent = this.samples.filter((sample) => timeMs - sample.timeMs <= STABILITY_WINDOW_MS);
    const jitter = Math.max(spread(recent.map((s) => s.features.centerX)), spread(recent.map((s) => s.features.shoulderY)));
    if (jitter > MAX_JITTER) {
      this.stillSince = null;
      return { status: "hold-still", progress: 0, hipsHidden, profile: null };
    }
    this.stillSince ??= timeMs;
    const progress = Math.min(1, (timeMs - this.stillSince) / REQUIRED_STILL_MS);
    if (progress < 1) return { status: "calibrating", progress, hipsHidden, profile: null };

    const window = this.samples.filter((sample) => sample.timeMs >= this.stillSince!);
    this.result = averageProfile(
      window.map((s) => s.features),
      Date.now(),
    );
    return { status: "done", progress: 1, hipsHidden, profile: this.result };
  }

  private restart(status: CalibrationStatus, hipsHidden: boolean): CalibrationProgress {
    this.samples = [];
    this.stillSince = null;
    return { status, progress: 0, hipsHidden, profile: null };
  }
}

const spread = (values: number[]): number => (values.length < 2 ? 0 : Math.max(...values) - Math.min(...values));

const mean = (values: number[]): number => values.reduce((sum, value) => sum + value, 0) / Math.max(1, values.length);

/** Averages a still window into a calibration profile, estimating torso length when hips are hidden. */
export const averageProfile = (features: BodyFeatures[], capturedAt: number): CalibrationProfile => {
  const shoulderWidth = mean(features.map((f) => f.shoulderWidth));
  const withHips = features.filter((f) => f.hipY !== null && f.torsoLength !== null);
  const torsoLength = withHips.length > 0 ? mean(withHips.map((f) => f.torsoLength!)) : shoulderWidth * TORSO_PER_SHOULDER_WIDTH;
  const shoulderY = mean(features.map((f) => f.shoulderY));
  const rest = (pick: (f: BodyFeatures) => number | null) => {
    const values = features.map(pick).filter((value): value is number => value !== null);
    // Clamp so an odd calibration stance cannot make hand raises impossible.
    return values.length > 0 ? Math.min(0.3, Math.max(-0.3, mean(values))) : 0;
  };
  return {
    centerX: mean(features.map((f) => f.centerX)),
    shoulderY,
    hipY: withHips.length > 0 ? mean(withHips.map((f) => f.hipY!)) : shoulderY + torsoLength,
    shoulderWidth,
    torsoLength,
    leftHandRest: rest((f) => f.leftHandHeight),
    rightHandRest: rest((f) => f.rightHandHeight),
    capturedAt,
  };
};
