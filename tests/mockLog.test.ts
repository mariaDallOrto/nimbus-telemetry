import { describe, expect, test } from "bun:test";
import { elapsedSeconds, numericColumn, parseCsv } from "../src/telemetry/csv";
import { generateMockLog } from "../src/telemetry/mockLog";

const numbers = (values: readonly (number | null)[]) =>
  values.filter((value): value is number => value !== null);

describe("generateMockLog", () => {
  const { headers, rows } = parseCsv(generateMockLog());

  test("draws the same log on every run", () => {
    expect(generateMockLog()).toBe(generateMockLog());
  });

  test("changes with the seed", () => {
    expect(generateMockLog(1)).not.toBe(generateMockLog(2));
  });

  test("uses the columns of a real log", () => {
    expect(headers).toContain("Corrente_Med_A");
    expect(headers).toContain("TensaoTotal_V");
    expect(headers).toContain("Comando_Pct");
  });

  test("sweeps the stick from idle to full", () => {
    const stick = numbers(numericColumn(rows, "Comando_Pct"));
    expect(Math.min(...stick)).toBe(0);
    expect(Math.max(...stick)).toBe(100);
  });

  test("sags the battery under load", () => {
    const voltage = numbers(numericColumn(rows, "TensaoTotal_V"));
    expect(voltage[0] ?? 0).toBeGreaterThan(voltage[voltage.length - 1] ?? 0);
  });

  test("has sparse clamp readings", () => {
    const readings = numbers(numericColumn(rows, "Alicate_A"));
    expect(readings.length).toBeGreaterThan(2);
    expect(readings.length).toBeLessThan(rows.length / 20);
  });

  test("shows the packet loss as a jump in time", () => {
    const elapsed = elapsedSeconds(rows);
    const biggestStep = Math.max(
      ...elapsed.map((value, index) => value - (elapsed[index - 1] ?? value)),
    );
    expect(biggestStep).toBeGreaterThan(2);
  });
});
