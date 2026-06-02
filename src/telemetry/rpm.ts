import type { MotorConfig } from "./types";

/**
 * Estimate motor RPM from a telemetry sample and motor constants:
 *   rpm = ((Vpack · duty) − I · R) · KV
 * where duty is the stick command as a fraction. This is the back-EMF
 * approximation the original dashboard used; it is only as accurate as the
 * KV and winding-resistance the user enters.
 */
export function estimateRpm(
  sample: { voltage: number; stickPct: number; current: number },
  motor: Pick<MotorConfig, "kv" | "resistance">,
): number {
  const duty = sample.stickPct / 100;
  const backEmf = sample.voltage * duty - sample.current * motor.resistance;
  return Math.round(backEmf * motor.kv);
}
