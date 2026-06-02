/** Last finite value of a numeric series, or null when none exists. */
export function lastNumber(values: readonly (number | null)[]): number | null {
  for (let i = values.length - 1; i >= 0; i--) {
    const value = values[i];
    if (typeof value === "number" && Number.isFinite(value)) return value;
  }
  return null;
}

/** Format a value to fixed decimals, or an em dash when null. */
export function fixedOrDash(value: number | null, digits: number): string {
  return value === null ? "—" : value.toFixed(digits);
}

/** Format a rounded integer, or an em dash when null. */
export function intOrDash(value: number | null): string {
  return value === null ? "—" : String(Math.round(value));
}

/** Tail slice of an array, last `count` items. */
export function tail<T>(values: readonly T[], count: number): T[] {
  return count >= values.length ? [...values] : values.slice(values.length - count);
}
