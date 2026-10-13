/* Rounding and medians shared by every metric.

   Shares and averages are ratios of integers, so they are rounded from the
   exact fraction rather than from a float: no 0.1 + 0.2 noise, and the same
   half-to-even rule Python's round() uses, which keeps parity with legacy. */

/** num / den rounded to `decimals`, half to even, computed on integers. 0 when den is 0. */
export function ratio(num: number, den: number, decimals = 0): number {
  if (den === 0) return 0;
  const scale = 10 ** decimals;
  const scaled = num * scale;
  const q = Math.floor(scaled / den);
  const twice = 2 * (scaled - q * den);
  const rounded = twice > den || (twice === den && q % 2 !== 0) ? q + 1 : q;
  return rounded / scale;
}

/** Percent of num in den, half to even. */
export const percent = (num: number, den: number, decimals = 0) => ratio(num * 100, den, decimals);

/**
 * Exact median; null for no values. Legacy truncated an even-count median to
 * whole seconds and returned 0 for "no data" (C5).
 */
export function median(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/**
 * Integer percentages that sum to exactly 100 (largest remainder). Ties go to
 * the smaller count, which keeps equal counts equal.
 */
export function largestRemainder(counts: readonly number[]): number[] {
  const total = counts.reduce((a, b) => a + b, 0);
  if (total === 0) return counts.map(() => 0);
  const pct = counts.map((c) => Math.floor((c * 100) / total));
  const rem = counts.map((c) => (c * 100) % total);
  const order = counts.map((_, i) => i).sort((a, b) => rem[b]! - rem[a]! || counts[a]! - counts[b]! || a - b);
  let left = 100 - pct.reduce((a, b) => a + b, 0);
  for (const i of order) {
    if (left-- <= 0) break;
    pct[i]! += 1;
  }
  return pct;
}

/**
 * Entries ranked by count, ties in first-seen order (a Map keeps insertion
 * order), matching Python's Counter.most_common.
 */
export function rank<K extends string>(counts: Map<K, number>, limit = Infinity): { key: K; count: number }[] {
  return [...counts]
    .map(([key, count], index) => ({ key, count, index }))
    .sort((a, b) => b.count - a.count || a.index - b.index)
    .slice(0, limit)
    .map(({ key, count }) => ({ key, count }));
}
