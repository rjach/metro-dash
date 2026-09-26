/**
 * One Euro filter (Casiez et al. 2012): heavy smoothing when a signal is
 * still, light smoothing when it moves fast. Removes landmark jitter without
 * adding the lag a plain moving average would to fast gestures like jumps.
 */
export class OneEuroFilter {
  private previous: number | null = null;
  private previousDerivative = 0;
  private previousTime = 0;

  constructor(
    private readonly minCutoff = 1.4,
    private readonly beta = 0.6,
    private readonly derivativeCutoff = 1.0,
  ) {}

  reset(): void {
    this.previous = null;
    this.previousDerivative = 0;
  }

  /**
   * @param value - Raw sample
   * @param timeSeconds - Monotonic timestamp in seconds
   */
  filter(value: number, timeSeconds: number): number {
    if (this.previous === null) {
      this.previous = value;
      this.previousTime = timeSeconds;
      return value;
    }
    const dt = Math.max(1e-3, timeSeconds - this.previousTime);
    this.previousTime = timeSeconds;
    const derivative = (value - this.previous) / dt;
    const smoothedDerivative = this.lowPass(derivative, this.previousDerivative, this.alpha(this.derivativeCutoff, dt));
    this.previousDerivative = smoothedDerivative;
    const cutoff = this.minCutoff + this.beta * Math.abs(smoothedDerivative);
    const result = this.lowPass(value, this.previous, this.alpha(cutoff, dt));
    this.previous = result;
    return result;
  }

  /** Smoothed rate of change (units/second) from the last update. */
  get velocity(): number {
    return this.previousDerivative;
  }

  private alpha(cutoff: number, dt: number): number {
    const tau = 1 / (2 * Math.PI * cutoff);
    return 1 / (1 + tau / dt);
  }

  private lowPass(value: number, previous: number, alpha: number): number {
    return alpha * value + (1 - alpha) * previous;
  }
}
