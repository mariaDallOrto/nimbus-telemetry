import { describe, expect, test } from "bun:test";
import { parseTelemetryMessage } from "../src/telemetry/parseMessage";

describe("parseTelemetryMessage", () => {
  test("parses a sample frame with cells", () => {
    const message = parseTelemetryMessage(
      JSON.stringify({ rssi: -60, pwmVal: 50, vTotal: 16.8, current: 12.5, c1: 4.2 }),
    );
    expect(message?.kind).toBe("sample");
    if (message?.kind !== "sample") throw new Error("expected sample");
    expect(message.sample.rssi).toBe(-60);
    expect(message.sample.stickPct).toBe(50);
    expect(message.sample.cells.c1).toBe(4.2);
    expect(message.sample.cells.c2).toBeNull();
  });

  test("treats a missing rssi as null without dropping the sample", () => {
    const message = parseTelemetryMessage(JSON.stringify({ pwmVal: 0, vTotal: 16, current: 0 }));
    expect(message?.kind).toBe("sample");
    if (message?.kind !== "sample") throw new Error("expected sample");
    expect(message.sample.rssi).toBeNull();
  });

  test("keeps mean current and peak current separate", () => {
    const message = parseTelemetryMessage(
      JSON.stringify({ pwmVal: 0, vTotal: 16, current: 1.2, currentPeak: 7.9 }),
    );
    if (message?.kind !== "sample") throw new Error("expected sample");
    expect(message.sample.current).toBe(1.2);
    expect(message.sample.currentPeak).toBe(7.9);
  });

  test("leaves peak current null when the frame omits it", () => {
    const message = parseTelemetryMessage(JSON.stringify({ pwmVal: 0, vTotal: 16, current: 1.2 }));
    if (message?.kind !== "sample") throw new Error("expected sample");
    expect(message.sample.currentPeak).toBeNull();
  });

  test("parses a STATUS frame", () => {
    const message = parseTelemetryMessage(
      JSON.stringify({ type: "STATUS", recState: "STARTED", file: "log1.csv", rxMode: "BI" }),
    );
    expect(message?.kind).toBe("status");
    if (message?.kind !== "status") throw new Error("expected status");
    expect(message.status.phase).toBe("started");
    expect(message.status.file).toBe("log1.csv");
    expect(message.status.rxMode).toBe("BI");
  });

  test("reads the zero offset stored on the board", () => {
    const message = parseTelemetryMessage(
      JSON.stringify({ type: "STATUS", recState: "STOPPED", currentZeroA: -0.123 }),
    );
    if (message?.kind !== "status") throw new Error("expected status");
    expect(message.status.currentZeroA).toBe(-0.123);
  });

  test("parses a calibration confirmation", () => {
    expect(parseTelemetryMessage('{"type":"CALIBRATION"}')).toEqual({ kind: "calibrated" });
  });

  test("returns null for malformed json", () => {
    expect(parseTelemetryMessage("{not json")).toBeNull();
  });

  test("returns null when required sample fields are missing", () => {
    expect(parseTelemetryMessage(JSON.stringify({ rssi: -60 }))).toBeNull();
  });

  test("returns null for an unknown status state", () => {
    expect(
      parseTelemetryMessage(JSON.stringify({ type: "STATUS", recState: "PAUSED" })),
    ).toBeNull();
  });
});
