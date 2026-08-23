export function chargedActionStrength(heldMs, chargeMs = 900, minimum = 0.35) {
  const safeChargeMs = Math.max(1, Number(chargeMs) || 1);
  const safeMinimum = Math.max(0, Math.min(1, Number(minimum) || 0));
  const progress = Math.max(0, Math.min(1, (Number(heldMs) || 0) / safeChargeMs));
  return safeMinimum + (1 - safeMinimum) * progress;
}
