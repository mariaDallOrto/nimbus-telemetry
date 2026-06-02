import { describe, expect, test } from "bun:test";
import { movingAverage } from "../src/telemetry/movingAverage";

describe("movingAverage", () => {
  test("returns a copy unchanged when the window is 1", () => {
    const input = [1, 2, 3];
    const result = movingAverage(input, 1);
    expect(result).toEqual([1, 2, 3]);
    expect(result).not.toBe(input);
  });

  test("returns a copy unchanged when the window is below 1", () => {
    expect(movingAverage([4, 5], 0)).toEqual([4, 5]);
  });

  test("averages a trailing window", () => {
    expect(movingAverage([2, 4, 6, 8], 2)).toEqual([2, 3, 5, 7]);
  });

  test("grows the window only up to the available leading samples", () => {
    expect(movingAverage([10, 20, 30], 5)).toEqual([10, 15, 20]);
  });

  test("skips null gaps inside the window", () => {
    expect(movingAverage([2, null, 4], 3)).toEqual([2, 2, 3]);
  });

  test("yields null when a window contains no numeric samples", () => {
    expect(movingAverage([null, null], 2)).toEqual([null, null]);
  });
});
