/**
 * Deterministic seeded PRNG (mulberry32). The generator state lives inside
 * the WorldState so replaying the same seed and ordered actions reproduces
 * the same world exactly.
 */
export interface Rng {
  next(): number; // [0,1)
  range(min: number, max: number): number;
  int(min: number, maxInclusive: number): number;
  chance(p: number): boolean;
  normal(mean?: number, sd?: number): number;
  pick<T>(items: readonly T[]): T;
  state(): number;
  /** false in forecast / scenario projections: every random shock is zero */
  readonly stochastic: boolean;
}

export function createRng(seedState: number, stochastic = true): Rng {
  let s = seedState >>> 0;
  const raw = () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const rng: Rng = {
    stochastic,
    next: () => (stochastic ? raw() : 0.5),
    range: (min, max) => min + (max - min) * rng.next(),
    int: (min, max) => Math.floor(rng.range(min, max + 1 - 1e-9)),
    chance: (p) => (stochastic ? raw() < p : false),
    normal: (mean = 0, sd = 1) => {
      if (!stochastic) return mean;
      const u = Math.max(raw(), 1e-12);
      const v = raw();
      return mean + sd * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
    },
    pick: (items) => items[Math.min(items.length - 1, Math.floor(rng.next() * items.length))],
    state: () => s,
  };
  return rng;
}
