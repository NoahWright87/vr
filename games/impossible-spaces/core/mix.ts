/**
 * Linked weights (Humble Bundle style): all unlocked weights always sum to 100.
 * Setting one redistributes the difference across the other UNLOCKED weights,
 * in proportion to their current values (equally if they're all zero).
 */
export function rebalance(weights: Record<string, number>, locked: Set<string>, key: string, value: number): Record<string, number> {
  const out = { ...weights };
  const lockedSum = Object.entries(out).filter(([k]) => locked.has(k) && k !== key).reduce((a, [, v]) => a + v, 0);
  const others = Object.keys(out).filter(k => k !== key && !locked.has(k));
  const v = Math.max(0, Math.min(others.length ? 100 - lockedSum : out[key], value));
  const pool = 100 - lockedSum - v;
  const cur = others.reduce((a, k) => a + out[k], 0);
  out[key] = v;
  for (const k of others) out[k] = cur > 1e-9 ? (out[k] / cur) * pool : pool / others.length;
  return out;
}
