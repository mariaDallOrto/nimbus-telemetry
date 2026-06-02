import { describe, expect, test } from "bun:test";
import { niceBounds, niceStep, stickyBounds } from "../src/telemetry/axis";

describe("niceStep", () => {
  test("rounds to 1-2-5 magnitudes", () => {
    expect(niceStep(0.8)).toBe(1);
    expect(niceStep(1.5)).toBe(2);
    expect(niceStep(4)).toBe(5);
    expect(niceStep(8)).toBe(10);
  });

  test("guards non-positive input", () => {
    expect(niceStep(0)).toBe(1);
    expect(niceStep(-5)).toBe(1);
  });
});

describe("niceBounds", () => {
  test("returns null with no numeric values", () => {
    expect(niceBounds([null, null])).toBeNull();
  });

  test("brackets the data in round numbers", () => {
    const bounds = niceBounds([0, 42, 87]);
    expect(bounds).not.toBeNull();
    expect(bounds && bounds.min).toBeLessThanOrEqual(0);
    expect(bounds && bounds.max).toBeGreaterThanOrEqual(87);
  });

  test("pads a flat series so it stays visible", () => {
    const bounds = niceBounds([5, 5, 5]);
    expect(bounds && bounds.min).toBeLessThan(5);
    expect(bounds && bounds.max).toBeGreaterThan(5);
  });
});

describe("stickyBounds", () => {
  test("adopts the target when there are no previous bounds", () => {
    const next = stickyBounds(null, [0, 10]);
    expect(next).not.toBeNull();
  });

  test("grows immediately when data exceeds the current ceiling", () => {
    const first = stickyBounds(null, [0, 10]);
    const grown = stickyBounds(first, [0, 1000]);
    expect(grown && grown.max).toBeGreaterThanOrEqual(1000);
  });

  test("keeps current bounds when the new target only nudges within a step", () => {
    const first = stickyBounds(null, [0, 100]);
    const next = stickyBounds(first, [0, 98]);
    expect(next).toEqual(first);
  });
});
