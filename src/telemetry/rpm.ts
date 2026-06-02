type RpmInputs = { voltage: number; stickPct: number; current: number };
type MotorConstants = { kv: number; resistance: number; reduction?: number };

/**
 * Estimate output-shaft RPM from a telemetry sample and motor constants:
 *   motorRpm = ((Vpack · duty) − I · R) · KV
 *   outputRpm = motorRpm / reduction
 * where duty is the stick command as a fraction and `reduction` is the gearbox
 * ratio (motor : shaft). A reduction of 1 (or unset) means direct drive. This
 * is the back-EMF approximation; accuracy depends on the KV, winding
 * resistance and reduction the user enters.
 */
export function estimateRpm(sample: RpmInputs, motor: MotorConstants): number {
  const duty = sample.stickPct / 100;
  const backEmf = sample.voltage * duty - sample.current * motor.resistance;
  const motorRpm = backEmf * motor.kv;
  const reduction = motor.reduction && motor.reduction > 0 ? motor.reduction : 1;
  return Math.round(motorRpm / reduction);
}
