// Deterministic RNG (mulberry32). All randomness in core goes through this.

export function rnd(state: { rng: number }): number {
  state.rng = (state.rng + 0x6d2b79f5) | 0;
  let t = state.rng;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

export function rndRange(s: { rng: number }, a: number, b: number): number {
  return a + rnd(s) * (b - a);
}

/** gaussian-ish noise via central limit, mean 0 */
export function rndNoise(s: { rng: number }, scale: number): number {
  return ((rnd(s) + rnd(s) + rnd(s)) / 1.5 - 1) * scale;
}
