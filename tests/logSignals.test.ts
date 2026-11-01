import { describe, expect, test } from "bun:test";
import { defaultLogSignals, logSignals } from "../src/charts/logSignals";
import { CSV_LOG_HEADER } from "../src/telemetry/csvLog";

const HEADERS = CSV_LOG_HEADER.split(",");

describe("defaultLogSignals", () => {
  test("starts with mean current, stick and pack voltage on a moving average of 15", () => {
    expect(defaultLogSignals(HEADERS)).toEqual([
      { id: "Corrente_Med_A", movingAverage: 15 },
      { id: "Comando_Pct", movingAverage: 15 },
      { id: "TensaoTotal_V", movingAverage: 15 },
    ]);
  });

  test("uses the only current column of older logs", () => {
    const ids = defaultLogSignals(["Timestamp", "Corrente_A", "Comando_Pct"]);
    expect(ids.map((signal) => signal.id)).toEqual(["Corrente_A", "Comando_Pct"]);
  });
});

describe("logSignals", () => {
  const signals = logSignals(HEADERS, () => []);

  test("leaves out time and packet columns", () => {
    const ids = signals.map((signal) => signal.id);
    expect(ids).not.toContain("Timestamp");
    expect(ids).not.toContain("PacketID");
  });

  test("groups the current columns on one scale", () => {
    const currents = signals.filter((signal) => signal.group === "Corrente");
    expect(new Set(currents.map((signal) => signal.scaleGroup))).toEqual(new Set(["current"]));
  });

  test("keeps cells off the pack voltage scale", () => {
    const cell = signals.find((signal) => signal.id === "C1");
    const pack = signals.find((signal) => signal.id === "TensaoTotal_V");
    expect(cell?.scaleGroup).not.toBe(pack?.scaleGroup);
  });

  test("lists current first in the picker", () => {
    expect(signals[0]?.group).toBe("Corrente");
  });

  test("still offers columns it does not know", () => {
    const [unknown] = logSignals(["Temperatura_C"], () => []);
    expect(unknown?.group).toBe("Outros");
  });
});
