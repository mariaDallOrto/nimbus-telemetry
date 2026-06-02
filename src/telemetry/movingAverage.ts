/**
 * Trailing simple moving average. A window of 1 (or less) returns a copy
 * unchanged. Non-numeric gaps (null) are skipped in each window; a window
 * with no numeric samples yields null so charts render a break instead of a
 * misleading zero.
 */
export function movingAverage(
  values: readonly (number | null)[],
  window: number,
): (number | null)[] {
  if (window <= 1) return [...values];
  return values.map((_, index) => {
    let sum = 0;
    let count = 0;
    for (let j = Math.max(0, index - window + 1); j <= index; j++) {
      const value = values[j];
      if (typeof value === "number" && Number.isFinite(value)) {
        sum += value;
        count += 1;
      }
    }
    return count > 0 ? sum / count : null;
  });
}
