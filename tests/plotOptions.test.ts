import { describe, expect, test } from "bun:test";
import { buildPlotOptions, formatElapsed } from "../src/charts/plotOptions";

const X_AXIS = { format: String, steps: [1] };
const CURRENT = { label: "Corrente", color: "#f00", scaleGroup: "current", unit: "A" };
const PEAK = { label: "Pico", color: "#f88", scaleGroup: "current", unit: "A" };
const STICK = {
  label: "Stick",
  color: "#00f",
  scaleGroup: "stick",
  unit: "%",
  range: [0, 100] as const,
};
const VOLTAGE = { label: "Tensão", color: "#0f0", scaleGroup: "voltage", unit: "V" };

describe("buildPlotOptions axes", () => {
  test("draws one visible axis per unit group, in the series color", () => {
    const { axes } = buildPlotOptions({ series: [CURRENT, PEAK, STICK, VOLTAGE], xAxis: X_AXIS });
    const yAxes = axes?.slice(1) ?? [];
    expect(yAxes.map((axis) => axis.label)).toEqual(["A", "%", "V"]);
    expect(yAxes.map((axis) => axis.stroke)).toEqual(["#f00", "#00f", "#0f0"]);
    expect(yAxes.every((axis) => axis.show !== false)).toBe(true);
  });

  test("alternates axes between left and right", () => {
    const { axes } = buildPlotOptions({ series: [CURRENT, STICK, VOLTAGE], xAxis: X_AXIS });
    expect(axes?.slice(1).map((axis) => axis.side)).toEqual([3, 1, 3]);
  });

  test("keeps gridlines on the first axis only", () => {
    const { axes } = buildPlotOptions({ series: [CURRENT, STICK], xAxis: X_AXIS });
    expect(axes?.slice(1).map((axis) => axis.grid?.show)).toEqual([true, false]);
  });

  test("puts every series on one axis when the scale is shared", () => {
    const { axes, series } = buildPlotOptions({
      series: [CURRENT, STICK],
      xAxis: X_AXIS,
      sharedScale: true,
    });
    expect(axes).toHaveLength(2);
    expect(new Set(series.slice(1).map((entry) => entry.scale)).size).toBe(1);
  });
});

describe("buildPlotOptions scales", () => {
  test("locks bounded quantities to their range", () => {
    const { scales, series } = buildPlotOptions({ series: [STICK], xAxis: X_AXIS });
    const scale = scales?.[series[1]?.scale ?? ""];
    expect(scale).toEqual({ auto: false, range: [0, 100] });
  });

  test("keeps a live axis still while noise stays inside its bounds", () => {
    const { scales, series } = buildPlotOptions({ series: [CURRENT], xAxis: X_AXIS, live: true });
    const key = series[1]?.scale ?? "";
    const range = scales?.[key]?.range;
    if (typeof range !== "function") throw new Error("expected a range function");
    const plot = {} as Parameters<typeof range>[0];
    const first = range(plot, 10, 20, key);
    expect(range(plot, 9.5, 20.5, key)).toEqual(first);
  });

  test("streams without pixel snapping only on live charts", () => {
    expect(buildPlotOptions({ series: [], xAxis: X_AXIS, live: true }).pxAlign).toBe(false);
    expect(buildPlotOptions({ series: [], xAxis: X_AXIS }).pxAlign).toBeUndefined();
  });
});

describe("formatElapsed", () => {
  test("prints minutes and seconds", () => {
    expect(formatElapsed(65)).toBe("1:05");
  });

  test("shows tenths only below the second", () => {
    expect(formatElapsed(5.5)).toBe("0:05.5");
  });
});
