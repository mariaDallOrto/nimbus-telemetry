import { describe, expect, test } from "bun:test";
import type { CsvRow } from "../src/telemetry/csv";
import {
  HAI_WEAPON,
  consumedMah,
  fightBudget,
  interpolate,
  logDurationSeconds,
  sheetRpm,
  stickPoints,
  weaponCurve,
  weaponEnergy,
  type FightPlan,
} from "../src/telemetry/energy";

describe("spreadsheet parity", () => {
  test("sheet RPM at 100 % matches the Arma tab (21654 RPM)", () => {
    expect(sheetRpm(100, HAI_WEAPON)).toBeCloseTo(21654.135, 2);
  });

  test("energy at the sheet RPM matches the Arma tab (468.08 J, 35.02 m)", () => {
    const energy = weaponEnergy(sheetRpm(100, HAI_WEAPON), HAI_WEAPON);
    expect(energy.joules).toBeCloseTo(468.0837, 3);
    expect(energy.meters).toBeCloseTo(35.0173, 3);
  });

  test("energy scales with the square of the stick", () => {
    const full = weaponEnergy(sheetRpm(100, HAI_WEAPON), HAI_WEAPON).joules;
    const half = weaponEnergy(sheetRpm(50, HAI_WEAPON), HAI_WEAPON).joules;
    expect(half / full).toBeCloseTo(0.25, 6);
  });
});

function row(second: number, stick: number, current: number, clamp: number | "" = ""): CsvRow {
  return {
    Timestamp: `2026-10-24T14_00_${String(second).padStart(2, "0")}`,
    Comando_Pct: stick,
    TensaoTotal_V: 16,
    Corrente_Med_A: current,
    Alicate_A: clamp,
  };
}

describe("stickPoints", () => {
  test("uses the held plateau, not a stick spike on the clamp row", () => {
    const rows = [
      row(0, 58, 9),
      row(0, 58, 9),
      row(0, 58, 9),
      row(1, 60, 9, 10.1),
      row(1, 58, 9),
      row(1, 70, 30),
      row(1, 58, 9),
    ];
    const [point] = stickPoints(rows, "Corrente_Med_A", "Alicate_A", HAI_WEAPON, 3);
    expect(point?.stickSet).toBe(60);
    expect(point?.stickHeld).toBe(58);
    expect(point?.samples).toBe(6);
    expect(point?.current).toBeCloseTo(9, 6);
    expect(point?.clamp).toBe(10.1);
    expect(point?.rpmSheet).toBeCloseTo(sheetRpm(58, HAI_WEAPON), 6);
  });
});

describe("log integration", () => {
  test("duration pads the whole-second span by one second", () => {
    expect(logDurationSeconds([row(0, 0, 0), row(9, 0, 0)])).toBe(10);
  });

  test("consumed charge integrates positive current only", () => {
    const rows = Array.from({ length: 36 }, (_, i) => row(Math.floor(i / 10), 0, i % 2 ? 10 : -10));
    // 4 s span, 36 rows → dt = 1/9 s; 18 rows at 10 A → 20 A·s → 5.556 mAh
    expect(consumedMah(rows, "Corrente_Med_A")).toBeCloseTo(20 / 3.6, 6);
  });
});

describe("interpolate", () => {
  const curve: [number, number][] = [
    [0, 0],
    [50, 6],
    [100, 20],
  ];
  test("is linear between samples and clamped outside", () => {
    expect(interpolate(curve, 25)).toBe(3);
    expect(interpolate(curve, 75)).toBe(13);
    expect(interpolate(curve, 120)).toBe(20);
    expect(interpolate(curve, -5)).toBe(0);
  });
});

describe("fightBudget", () => {
  const curve = weaponCurve(
    [
      {
        row: 0,
        stickSet: 50,
        stickHeld: 50,
        samples: 1,
        voltage: 15,
        current: 6,
        clamp: 6,
        rpmTelemetry: 0,
        rpmSheet: 0,
        energySheet: { joules: 100, meters: 0 },
      },
      {
        row: 1,
        stickSet: 100,
        stickHeld: 100,
        samples: 1,
        voltage: 14,
        current: 20,
        clamp: 20,
        rpmTelemetry: 0,
        rpmSheet: 0,
        energySheet: { joules: 360, meters: 0 },
      },
    ],
    "telemetry",
  );
  const plan: FightPlan = {
    capacityMah: 930,
    usableFraction: 0.8,
    durationSeconds: 180,
    driveCurrent: 7,
    shares: [{ stickPct: 100, seconds: 36 }],
    spinUps: 10,
    spinUpStickPct: 100,
    spinUpEfficiency: 0.5,
  };

  test("adds drive, steady weapon draw and spin-ups", () => {
    const budget = fightBudget(plan, curve);
    expect(budget.budgetMah).toBeCloseTo(744, 6);
    expect(budget.driveMah).toBeCloseTo(350, 6);
    expect(budget.weaponSteadyMah).toBeCloseTo(200, 6);
    // 360 J / (14 V · 0.5) = 51.43 C = 14.29 mAh each
    expect(budget.spinUpMahEach).toBeCloseTo(360 / 7 / 3.6, 6);
    expect(budget.idleSeconds).toBe(144);
    expect(budget.marginMah).toBeCloseTo(744 - 350 - 200 - budget.spinUpMah, 6);
  });

  test("turns the leftover budget into an average current and an equivalent stick", () => {
    const budget = fightBudget({ ...plan, spinUps: 0 }, curve);
    // (744 − 350) mAh over 180 s = 7.88 A
    expect(budget.weaponAverageLimit).toBeCloseTo(7.88, 6);
    expect(budget.continuousStickPct).toBeCloseTo(50 + (1.88 / 14) * 50, 6);
    expect(budget.fullThrottleSeconds).toBeCloseTo((394 * 3.6) / 20, 6);
  });
});
