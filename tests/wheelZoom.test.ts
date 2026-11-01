import { describe, expect, test } from "bun:test";
import { pannedRange, zoomedRange } from "../src/charts/wheelZoom";

const LIMITS = { min: 0, max: 100 };

describe("zoomedRange", () => {
  test("keeps the point under the mouse in place", () => {
    const zoomed = zoomedRange(LIMITS, LIMITS, 25, 0.5);
    expect((25 - zoomed.min) / (zoomed.max - zoomed.min)).toBeCloseTo(0.25);
  });

  test("never leaves the data when zooming out", () => {
    expect(zoomedRange({ min: 80, max: 100 }, LIMITS, 90, 100)).toEqual(LIMITS);
  });

  test("stops at a minimum span", () => {
    const zoomed = zoomedRange({ min: 50, max: 50.01 }, LIMITS, 50, 0.01);
    expect(zoomed.max - zoomed.min).toBeCloseTo(0.2);
  });
});

describe("pannedRange", () => {
  test("moves the view keeping its span", () => {
    expect(pannedRange({ min: 10, max: 30 }, LIMITS, 1)).toEqual({ min: 12, max: 32 });
  });

  test("stops at the end of the data", () => {
    expect(pannedRange({ min: 90, max: 100 }, LIMITS, 1)).toEqual({ min: 90, max: 100 });
  });
});
