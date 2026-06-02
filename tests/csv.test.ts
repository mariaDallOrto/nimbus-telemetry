import { describe, expect, test } from "bun:test";
import { CsvParseError, numericColumn, parseCsv, timeLabels } from "../src/telemetry/csv";

const SAMPLE = [
  "Timestamp,PacketID,Corrente_A,TensaoTotal_V",
  "2023-10-10T14_00_00,1,12.5,16.8",
  "2023-10-10T14_00_01,2,13.0,16.7",
].join("\n");

describe("parseCsv", () => {
  test("parses headers and coerces numeric cells", () => {
    const parsed = parseCsv(SAMPLE);
    expect(parsed.headers).toEqual(["Timestamp", "PacketID", "Corrente_A", "TensaoTotal_V"]);
    expect(parsed.rows).toHaveLength(2);
    expect(parsed.rows[0]?.["Corrente_A"]).toBe(12.5);
  });

  test("keeps timestamp columns as text", () => {
    const parsed = parseCsv(SAMPLE);
    expect(parsed.rows[0]?.["Timestamp"]).toBe("2023-10-10T14_00_00");
  });

  test("skips rows whose column count differs from the header", () => {
    const text = "A,B\n1,2\n3\n4,5";
    expect(parseCsv(text).rows).toHaveLength(2);
  });

  test("throws when there are no data rows", () => {
    expect(() => parseCsv("A,B")).toThrow(CsvParseError);
  });

  test("throws when no row is valid", () => {
    expect(() => parseCsv("A,B\n1\n2")).toThrow(CsvParseError);
  });
});

describe("numericColumn", () => {
  test("returns numbers and nulls for non-numeric cells", () => {
    const parsed = parseCsv(SAMPLE);
    expect(numericColumn(parsed.rows, "Corrente_A")).toEqual([12.5, 13.0]);
    expect(numericColumn(parsed.rows, "Timestamp")).toEqual([null, null]);
  });
});

describe("timeLabels", () => {
  test("shortens ISO timestamps to a readable time", () => {
    const parsed = parseCsv(SAMPLE);
    expect(timeLabels(parsed.rows)).toEqual(["14:00:00", "14:00:01"]);
  });
});
