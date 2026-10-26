// Weapon energy and battery budget for a spinner. Mirrors the "Arma" and
// "Elétrica" tabs of the team's "Cálculos - Robôs de Combate" spreadsheet so
// the numbers here match what the team already uses, and adds the measured
// side (telemetry + clamp meter) next to them.

import type { CsvRow } from "./csv";
import { estimateRpm } from "./rpm";

export const GRAVITY = 9.8;

export type WeaponParams = {
  /** Motor KV, rpm per volt. */
  kv: number;
  /** Winding resistance in ohms, for the back-EMF RPM estimate. */
  resistance: number;
  /** Reduction motor : weapon. */
  reduction: number;
  /** Weapon moment of inertia, kg·m². */
  inertia: number;
  /** Robot mass, kg (the spreadsheet's category mass). */
  robotMass: number;
  /** Series cell count. */
  cells: number;
  /** Volts per cell the spreadsheet assumes for its RPM (4 V). */
  voltsPerCell: number;
};

/** Hai's weapon as entered in the spreadsheet, with the motor constants used for the 2026-10-24 tests. */
export const HAI_WEAPON: WeaponParams = {
  kv: 1800,
  resistance: 0.01,
  reduction: 1.33,
  inertia: 0.00018206,
  robotMass: 1.364,
  cells: 4,
  voltsPerCell: 4,
};

export type Energy = { joules: number; meters: number };

/**
 * Stored kinetic energy of the weapon at a given RPM, in joules (½·I·ω²) and
 * in the spreadsheet's "m" unit: the height that energy would lift the whole
 * robot to (E / (m·g)).
 */
export function weaponEnergy(rpm: number, params: WeaponParams): Energy {
  const omega = (rpm * 2 * Math.PI) / 60;
  const joules = 0.5 * params.inertia * omega * omega;
  return { joules, meters: joules / (params.robotMass * GRAVITY) };
}

/** Spreadsheet RPM: KV · (cells · 4 V) · duty / reduction. No load, no sag. */
export function sheetRpm(stickPct: number, params: WeaponParams): number {
  const reduction = params.reduction > 0 ? params.reduction : 1;
  return (params.kv * params.cells * params.voltsPerCell * (stickPct / 100)) / reduction;
}

/** Telemetry RPM: back-EMF estimate from pack voltage, stick and current. */
export function telemetryRpm(
  voltage: number,
  stickPct: number,
  current: number,
  params: WeaponParams,
): number {
  return estimateRpm(
    { voltage, stickPct, current },
    { kv: params.kv, resistance: params.resistance, reduction: params.reduction },
  );
}

function num(row: CsvRow | undefined, header: string): number | null {
  const value = row?.[header];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length === 0) return 0;
  return sorted.length % 2 === 1
    ? (sorted[mid] ?? 0)
    : ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2;
}

function mean(values: readonly number[]): number {
  return values.length === 0 ? 0 : values.reduce((sum, v) => sum + v, 0) / values.length;
}

/** One stick level of a test: where a clamp reading was taken. */
export type StickPoint = {
  /** Row index of the clamp reading. */
  row: number;
  /** Stick % logged on the clamp row (the level being held). */
  stickSet: number;
  /** Median stick % around the reading; the plateau actually held. */
  stickHeld: number;
  /** Rows averaged for voltage and current (window rows within the stick tolerance). */
  samples: number;
  voltage: number;
  /** Telemetry mean current around the reading, A. */
  current: number;
  /** Clamp-meter reading, A. */
  clamp: number;
  rpmTelemetry: number;
  rpmSheet: number;
  /** Stored energy at the spreadsheet RPM; the page trusts this one. */
  energySheet: Energy;
};

export const STICK_TOLERANCE_PCT = 3;

/**
 * Collapse each clamp reading into a steady-state point. The stick jitters a
 * few percent around the level being held, so we take the median stick in a
 * ±`halfWindow`-row window and average voltage and current over the rows that
 * stay within {@link STICK_TOLERANCE_PCT} of it.
 */
export function stickPoints(
  rows: readonly CsvRow[],
  currentHeader: string,
  clampHeader: string,
  params: WeaponParams,
  halfWindow = 20,
): StickPoint[] {
  const points: StickPoint[] = [];
  rows.forEach((row, index) => {
    const clamp = num(row, clampHeader);
    const stickSet = num(row, "Comando_Pct");
    if (clamp === null || stickSet === null) return;
    const window = rows.slice(Math.max(0, index - halfWindow), index + halfWindow + 1);
    const sticks = window.map((r) => num(r, "Comando_Pct")).filter((v) => v !== null);
    const stickHeld = median(sticks);
    const steady = window.filter((r) => {
      const stick = num(r, "Comando_Pct");
      return stick !== null && Math.abs(stick - stickHeld) <= STICK_TOLERANCE_PCT;
    });
    const voltage = mean(steady.map((r) => num(r, "TensaoTotal_V")).filter((v) => v !== null));
    const current = mean(steady.map((r) => num(r, currentHeader)).filter((v) => v !== null));
    const rpmTelemetry = Math.max(0, telemetryRpm(voltage, stickHeld, current, params));
    const rpmSheet = sheetRpm(stickHeld, params);
    points.push({
      row: index,
      stickSet,
      stickHeld,
      samples: steady.length,
      voltage,
      current,
      clamp,
      rpmTelemetry,
      rpmSheet,
      energySheet: weaponEnergy(rpmSheet, params),
    });
  });
  return points;
}

function secondsOfDay(timestamp: unknown): number | null {
  if (typeof timestamp !== "string") return null;
  const match = /T(\d{2})[_:](\d{2})[_:](\d{2})/.exec(timestamp);
  if (!match) return null;
  return Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]);
}

/**
 * Log duration in seconds. Timestamps only have whole seconds, so the span
 * between the first and last row is padded by one second to cover both ends.
 */
export function logDurationSeconds(rows: readonly CsvRow[]): number {
  const first = secondsOfDay(rows[0]?.["Timestamp"]);
  const last = secondsOfDay(rows[rows.length - 1]?.["Timestamp"]);
  if (first === null || last === null || last < first) return 0;
  return last - first + 1;
}

/** Charge drawn over the log, mAh, integrating positive current at the mean sample period. */
export function consumedMah(rows: readonly CsvRow[], currentHeader: string): number {
  const duration = logDurationSeconds(rows);
  if (rows.length === 0 || duration === 0) return 0;
  const dt = duration / rows.length;
  const ampSeconds = rows.reduce((sum, row) => sum + Math.max(0, num(row, currentHeader) ?? 0), 0);
  return (ampSeconds * dt) / 3.6;
}

/** Piecewise-linear interpolation over (x, y) pairs, clamped to the end values. */
export function interpolate(points: readonly (readonly [number, number])[], x: number): number {
  const sorted = [...points].sort((a, b) => a[0] - b[0]);
  const first = sorted[0];
  const last = sorted[sorted.length - 1];
  if (!first || !last) return 0;
  if (x <= first[0]) return first[1];
  if (x >= last[0]) return last[1];
  for (let i = 1; i < sorted.length; i++) {
    const a = sorted[i - 1];
    const b = sorted[i];
    if (a && b && x <= b[0]) {
      const span = b[0] - a[0];
      return span === 0 ? b[1] : a[1] + ((x - a[0]) / span) * (b[1] - a[1]);
    }
  }
  return last[1];
}

export type CurrentSource = "telemetry" | "clamp";

/** Weapon curve sampled from a test: current and spreadsheet energy per held stick %, anchored at 0. */
export type WeaponCurve = {
  current: [number, number][];
  joules: [number, number][];
  voltage: [number, number][];
};

export function weaponCurve(points: readonly StickPoint[], source: CurrentSource): WeaponCurve {
  const rest = points[0]?.voltage ?? 0;
  return {
    current: [
      [0, 0],
      ...points.map((p): [number, number] => [
        p.stickHeld,
        source === "clamp" ? p.clamp : p.current,
      ]),
    ],
    joules: [[0, 0], ...points.map((p): [number, number] => [p.stickHeld, p.energySheet.joules])],
    voltage: [[0, rest], ...points.map((p): [number, number] => [p.stickHeld, p.voltage])],
  };
}

/** Seconds of the fight spent holding a stick level. */
export type StickShare = { stickPct: number; seconds: number };

export type FightPlan = {
  capacityMah: number;
  /** Fraction of the capacity you accept to use (0.8 keeps the pack healthy). */
  usableFraction: number;
  durationSeconds: number;
  /** Continuous drive current, A. */
  driveCurrent: number;
  /** Time at each weapon level; whatever is left of the fight is spent at 0 %. */
  shares: readonly StickShare[];
  /** How many times the weapon is brought from stopped back to `spinUpStickPct`. */
  spinUps: number;
  spinUpStickPct: number;
  /** Battery → stored kinetic energy efficiency during a spin-up. */
  spinUpEfficiency: number;
};

export type FightBudget = {
  budgetMah: number;
  driveMah: number;
  weaponSteadyMah: number;
  spinUpMahEach: number;
  spinUpMah: number;
  totalMah: number;
  /** Budget minus total; negative means the plan does not fit. */
  marginMah: number;
  /** Seconds the plan spends at 0 % (fight minus the listed shares). */
  idleSeconds: number;
  /** Average weapon current the budget allows over the fight, A. */
  weaponAverageLimit: number;
  /** Stick % that, held the whole fight, uses exactly the weapon budget. */
  continuousStickPct: number;
  continuousJoules: number;
  /** Seconds at 100 % the budget allows (rest of the fight at 0 %), after spin-ups. */
  fullThrottleSeconds: number;
};

/** Inverse of a monotonic curve: the x where y first reaches `target`. */
function inverse(points: readonly (readonly [number, number])[], target: number): number {
  const sorted = [...points].sort((a, b) => a[0] - b[0]);
  for (let i = 1; i < sorted.length; i++) {
    const a = sorted[i - 1];
    const b = sorted[i];
    if (a && b && target <= b[1]) {
      const rise = b[1] - a[1];
      return rise <= 0 ? b[0] : a[0] + ((target - a[1]) / rise) * (b[0] - a[0]);
    }
  }
  return sorted[sorted.length - 1]?.[0] ?? 0;
}

/**
 * Battery budget for one fight: drive + steady weapon draw at each planned
 * level + the charge spent re-accelerating the weapon after hits. A spin-up
 * costs E / (V · η) coulombs, where E is the stored energy at the target
 * level and V the pack voltage measured there.
 */
export function fightBudget(plan: FightPlan, curve: WeaponCurve): FightBudget {
  const budgetMah = plan.capacityMah * plan.usableFraction;
  const driveMah = (plan.driveCurrent * plan.durationSeconds) / 3.6;
  const planned = plan.shares.reduce((sum, share) => sum + Math.max(0, share.seconds), 0);
  const idleSeconds = Math.max(0, plan.durationSeconds - planned);
  const weaponSteadyMah = plan.shares.reduce(
    (sum, share) =>
      sum + (interpolate(curve.current, share.stickPct) * Math.max(0, share.seconds)) / 3.6,
    0,
  );
  const spinUpJoules = interpolate(curve.joules, plan.spinUpStickPct);
  const spinUpVoltage = interpolate(curve.voltage, plan.spinUpStickPct);
  const spinUpMahEach =
    spinUpVoltage > 0 && plan.spinUpEfficiency > 0
      ? spinUpJoules / (spinUpVoltage * plan.spinUpEfficiency) / 3.6
      : 0;
  const spinUpMah = spinUpMahEach * Math.max(0, plan.spinUps);
  const totalMah = driveMah + weaponSteadyMah + spinUpMah;
  const weaponMah = budgetMah - driveMah - spinUpMah;
  const weaponAverageLimit =
    plan.durationSeconds > 0 ? Math.max(0, (weaponMah * 3.6) / plan.durationSeconds) : 0;
  const continuousStickPct = inverse(curve.current, weaponAverageLimit);
  const fullCurrent = interpolate(curve.current, 100);
  return {
    budgetMah,
    driveMah,
    weaponSteadyMah,
    spinUpMahEach,
    spinUpMah,
    totalMah,
    marginMah: budgetMah - totalMah,
    idleSeconds,
    weaponAverageLimit,
    continuousStickPct,
    continuousJoules: interpolate(curve.joules, continuousStickPct),
    fullThrottleSeconds:
      fullCurrent > 0
        ? Math.min(plan.durationSeconds, Math.max(0, (weaponMah * 3.6) / fullCurrent))
        : 0,
  };
}
