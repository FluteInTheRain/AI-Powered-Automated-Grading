/** Weighted average of per-question scores (0-100), rounded to 2 decimals; 0 for no items. */
export function computeTotal(items: { weight: number; score: number }[]): number {
  const w = items.reduce((s, i) => s + i.weight, 0);
  if (w === 0) return 0;
  return Math.round((items.reduce((s, i) => s + i.weight * i.score, 0) / w) * 100) / 100;
}
