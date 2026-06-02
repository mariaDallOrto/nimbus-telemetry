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
