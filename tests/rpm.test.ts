import { describe, expect, test } from "bun:test";
import { estimateRpm } from "../src/telemetry/rpm";

describe("estimateRpm", () => {
  test("applies the back-EMF model", () => {
    // (16 * 0.5 - 10 * 0.1) * 100 = (8 - 1) * 100 = 700
    const rpm = estimateRpm(
      { voltage: 16, stickPct: 50, current: 10 },
      { kv: 100, resistance: 0.1 },
    );
    expect(rpm).toBe(700);
  });

  test("returns zero at zero throttle and zero current", () => {
    expect(
      estimateRpm({ voltage: 16, stickPct: 0, current: 0 }, { kv: 100, resistance: 0.1 }),
    ).toBe(0);
  });

  test("rounds to the nearest integer", () => {
    const rpm = estimateRpm(
      { voltage: 11.1, stickPct: 33, current: 2 },
      { kv: 90, resistance: 0.05 },
    );
    expect(Number.isInteger(rpm)).toBe(true);
  });
});
