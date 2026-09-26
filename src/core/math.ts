export const clamp = (value: number, min: number, max: number): number => (value < min ? min : value > max ? max : value);

export const lerp = (from: number, to: number, t: number): number => from + (to - from) * t;

/**
 * Frame-rate independent exponential smoothing toward a target.
 *
 * @param current - Current value
 * @param target - Value to approach
 * @param sharpness - Higher is snappier (1/seconds)
 * @param dt - Elapsed seconds
 */
export const damp = (current: number, target: number, sharpness: number, dt: number): number => lerp(current, target, 1 - Math.exp(-sharpness * dt));

export const smoothstep = (edge0: number, edge1: number, x: number): number => {
  const t = clamp((x - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
};

export const easeOutBack = (t: number): number => {
  const overshoot = 1.70158;
  const shifted = t - 1;
  return 1 + (overshoot + 1) * shifted ** 3 + overshoot * shifted ** 2;
};

/** Deterministic PRNG (mulberry32) so runs are reproducible in tests. */
export class Random {
  private state: number;

  constructor(seed: number = Date.now()) {
    this.state = seed >>> 0;
  }

  next(): number {
    this.state = (this.state + 0x6d2b79f5) >>> 0;
    let t = this.state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  range(min: number, max: number): number {
    return min + (max - min) * this.next();
  }

  int(minInclusive: number, maxInclusive: number): number {
    return Math.floor(this.range(minInclusive, maxInclusive + 1));
  }

  chance(probability: number): boolean {
    return this.next() < probability;
  }

  pick<T>(items: readonly T[]): T {
    if (items.length === 0) throw new Error("Random.pick called with an empty list");
    return items[Math.floor(this.next() * items.length)] as T;
  }

  /** Picks an entry with probability proportional to its weight. */
  weighted<T>(entries: readonly { item: T; weight: number }[]): T {
    const total = entries.reduce((sum, entry) => sum + Math.max(0, entry.weight), 0);
    if (total <= 0) throw new Error("Random.weighted requires at least one positive weight");
    let roll = this.next() * total;
    for (const entry of entries) {
      roll -= Math.max(0, entry.weight);
      if (roll <= 0) return entry.item;
    }
    return entries[entries.length - 1]!.item;
  }

  shuffle<T>(items: T[]): T[] {
    for (let i = items.length - 1; i > 0; i--) {
      const j = Math.floor(this.next() * (i + 1));
      [items[i], items[j]] = [items[j]!, items[i]!];
    }
    return items;
  }
}
