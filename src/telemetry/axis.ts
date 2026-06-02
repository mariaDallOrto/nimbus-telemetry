// Sticky, "nice"-rounded chart axes. Auto-fitting an axis to every frame makes
// the live chart jitter; instead we snap bounds to round numbers and only let
// them grow immediately, shrinking lazily (hysteresis) once there is a full
// step of slack. Ported from the original dashboard's anti-tremor logic.

export type AxisBounds = { min: number; max: number; step: number };

export function niceStep(raw: number): number {
  if (raw <= 0) return 1;
  const magnitude = Math.pow(10, Math.floor(Math.log10(raw)));
  const normalized = raw / magnitude;
  const nice = normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10;
  return nice * magnitude;
}

export function niceBounds(values: readonly (number | null)[]): AxisBounds | null {
  const numbers = values.filter(
    (value): value is number => typeof value === "number" && Number.isFinite(value),
  );
  if (numbers.length === 0) return null;
  let low = Math.min(...numbers);
  let high = Math.max(...numbers);
  if (low === high) {
    low -= 1;
    high += 1;
  }
  const padding = (high - low) * 0.1;
  low -= padding;
  high += padding;
  const step = niceStep((high - low) / 5);
  return { min: Math.floor(low / step) * step, max: Math.ceil(high / step) * step, step };
}

/**
 * Next axis bounds given the previous ones. Grows immediately on overflow but
 * shrinks only after the data stays well inside a two-step dead zone. The wide
 * hysteresis is deliberate: a one-step margin lets noisy series cross the
 * boundary back and forth every frame, which reads as the chart "jumping".
 */
export function stickyBounds(
  current: AxisBounds | null,
  values: readonly (number | null)[],
): AxisBounds | null {
  const target = niceBounds(values);
  if (!target) return current;
  if (!current) return target;

  const deadZone = target.step * 2;
  let { min, max } = current;
  if (target.min < min) min = target.min;
  if (target.max > max) max = target.max;
  if (target.min > min + deadZone) min = target.min;
  if (target.max < max - deadZone) max = target.max;
  return { min, max, step: target.step };
}
