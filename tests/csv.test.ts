import { describe, expect, test } from "bun:test";
import {
  CsvParseError,
  numericColumn,
  parseCsv,
  elapsedSeconds,
  timeLabels,
} from "../src/telemetry/csv";

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

describe("elapsedSeconds", () => {
  const rowsAt = (...times: string[]) =>
    parseCsv(["Timestamp,Corrente_A", ...times.map((time) => `${time},1`)].join("\n")).rows;

  test("counts seconds from the first row", () => {
    expect(elapsedSeconds(parseCsv(SAMPLE).rows)).toEqual([0, 1]);
  });

  test("spreads samples sharing a second across that second", () => {
    const rows = rowsAt(...Array.from({ length: 4 }, () => "2023-10-10T14_00_00"));
    expect(elapsedSeconds(rows)).toEqual([0, 0.25, 0.5, 0.75]);
  });

  test("keeps gaps left by lost packets", () => {
    expect(elapsedSeconds(rowsAt("2023-10-10T14_00_00", "2023-10-10T14_00_09"))).toEqual([0, 9]);
  });

  test("keeps counting across midnight", () => {
    expect(elapsedSeconds(rowsAt("2023-10-10T23_59_59", "2023-10-11T00_00_01"))).toEqual([0, 2]);
  });

  test("stays strictly ascending when the clock steps back", () => {
    const elapsed = elapsedSeconds(
      rowsAt("2023-10-10T14_00_05", "2023-10-10T14_00_06", "2023-10-10T14_00_05"),
    );
    expect(elapsed.every((value, index) => index === 0 || value > (elapsed[index - 1] ?? 0))).toBe(
      true,
    );
  });

  test("falls back to the row index without readable timestamps", () => {
    expect(elapsedSeconds(rowsAt("sem-hora", "sem-hora"))).toEqual([0, 1]);
  });
});
