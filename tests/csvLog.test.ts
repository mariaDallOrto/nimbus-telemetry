import { describe, expect, test } from "bun:test";
import { numericColumn, parseCsv } from "../src/telemetry/csv";
import { CSV_LOG_HEADER, formatCsvLogLine } from "../src/telemetry/csvLog";
import { parseTelemetryMessage } from "../src/telemetry/parseMessage";

const FIRMWARE_FRAME =
  '{"id":3539,"rssi":-48,"current":0.05,"currentPeak":1.36,"currentMin":-1.15,"pwmVal":0,"vTotal":16.72,"nCells":4,"c1":4.177,"c2":4.185,"c3":4.191,"c4":4.165,"c5":0.000,"c6":0.000,"loopMs":19,"samples":100,"pwmAgeMs":5,"heapKB":180,"i2cErr":0}';

function firmwareSample() {
  const message = parseTelemetryMessage(FIRMWARE_FRAME);
  if (message?.kind !== "sample") throw new Error("expected sample");
  return message.sample;
}

describe("formatCsvLogLine", () => {
  test("reproduces the row the firmware writes to the SD card", () => {
    const line = formatCsvLogLine(firmwareSample(), new Date(2026, 9, 24, 14, 34, 46));
    expect(line).toBe(
      "2026-10-24T14_34_46,3539,-48,1.36,0,16.72,4,4.177,4.185,4.191,4.165,0.000,0.000,0.05,-1.15,19,5",
    );
  });

  test("produces a file the analysis parser reads", () => {
    const line = formatCsvLogLine(firmwareSample(), new Date(2026, 9, 24, 14, 34, 46));
    const { headers, rows } = parseCsv(`${CSV_LOG_HEADER}\n${line}\n`);
    expect(headers).toContain("Corrente_Med_A");
    expect(numericColumn(rows, "Corrente_A")).toEqual([1.36]);
  });

  test("keeps the column count when optional fields are missing", () => {
    const message = parseTelemetryMessage('{"pwmVal":0,"vTotal":16,"current":1.2}');
    if (message?.kind !== "sample") throw new Error("expected sample");
    const line = formatCsvLogLine(message.sample, new Date(2026, 9, 24));
    expect(line.split(",")).toHaveLength(CSV_LOG_HEADER.split(",").length);
  });
});
