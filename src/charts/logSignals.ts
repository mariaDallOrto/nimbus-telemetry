import {
  CHART_COLOR_CLAMP,
  CHART_COLOR_CURRENT,
  CHART_COLOR_CURRENT_MIN,
  CHART_COLOR_CURRENT_PEAK,
  CHART_COLOR_RPM,
  CHART_COLOR_RSSI,
  CHART_COLOR_STICK,
  CHART_COLOR_VOLTAGE,
  seriesColor,
} from "./chartColors";
import type { Signal } from "./SignalExplorer";

/** Derived (not logged) column: RPM estimated from voltage, stick and current. */
export const RPM_COLUMN = "RPM_Est";
const MEAN_CURRENT_COLUMN = "Corrente_Med_A";
const PEAK_CURRENT_COLUMN = "Corrente_A";
const EXCLUDED_COLUMNS = new Set(["Timestamp", "PacketID"]);
const DEFAULT_MOVING_AVERAGE = 15;

type SignalLook = Omit<Signal, "id" | "data">;

const CURRENT_LOOK = { group: "Corrente", unit: "A", scaleGroup: "current", digits: 1 } as const;
const CELL_LOOK = { group: "Células", unit: "V", scaleGroup: "cells", digits: 3 } as const;
const TIMING_LOOK = { group: "Diagnóstico", unit: "ms", scaleGroup: "timing", digits: 0 } as const;

const COLUMN_LOOKS: Record<string, SignalLook> = {
  [MEAN_CURRENT_COLUMN]: { ...CURRENT_LOOK, label: "Corrente média", color: CHART_COLOR_CURRENT },
  [PEAK_CURRENT_COLUMN]: {
    ...CURRENT_LOOK,
    label: "Corrente pico",
    color: CHART_COLOR_CURRENT_PEAK,
  },
  Corrente_Min_A: { ...CURRENT_LOOK, label: "Corrente mínima", color: CHART_COLOR_CURRENT_MIN },
  Alicate_A: { ...CURRENT_LOOK, label: "Alicate", color: CHART_COLOR_CLAMP, markers: true },
  Comando_Pct: {
    label: "Stick",
    group: "Comando",
    unit: "%",
    scaleGroup: "stick",
    digits: 0,
    range: [0, 100],
    color: CHART_COLOR_STICK,
  },
  TensaoTotal_V: {
    label: "Tensão total",
    group: "Bateria",
    unit: "V",
    scaleGroup: "voltage",
    digits: 2,
    color: CHART_COLOR_VOLTAGE,
  },
  RSSI_dBm: {
    label: "RSSI",
    group: "Rádio",
    unit: "dBm",
    scaleGroup: "rssi",
    digits: 0,
    color: CHART_COLOR_RSSI,
  },
  [RPM_COLUMN]: {
    label: "RPM estimado",
    group: "Motor",
    scaleGroup: "rpm",
    unit: "RPM",
    digits: 0,
    color: CHART_COLOR_RPM,
  },
  C1: { ...CELL_LOOK, label: "Célula 1", color: seriesColor(0) },
  C2: { ...CELL_LOOK, label: "Célula 2", color: seriesColor(1) },
  C3: { ...CELL_LOOK, label: "Célula 3", color: seriesColor(2) },
  C4: { ...CELL_LOOK, label: "Célula 4", color: seriesColor(3) },
  C5: { ...CELL_LOOK, label: "Célula 5", color: seriesColor(4) },
  C6: { ...CELL_LOOK, label: "Célula 6", color: seriesColor(5) },
  Celulas_N: {
    label: "Células detectadas",
    group: "Diagnóstico",
    scaleGroup: "cellCount",
    digits: 0,
    color: seriesColor(6),
  },
  LoopMs: { ...TIMING_LOOK, label: "Loop", color: seriesColor(6) },
  PwmIdleMs: { ...TIMING_LOOK, label: "PWM parado", color: seriesColor(7) },
};

/** The mean current is the reliable reading. Older logs only have one current column. */
export function currentColumn(headers: readonly string[]): string {
  return headers.includes(MEAN_CURRENT_COLUMN) ? MEAN_CURRENT_COLUMN : PEAK_CURRENT_COLUMN;
}

const PICKER_ORDER = Object.keys(COLUMN_LOOKS);

function pickerRank(header: string): number {
  const rank = PICKER_ORDER.indexOf(header);
  return rank === -1 ? PICKER_ORDER.length : rank;
}

function isPlottable(header: string): boolean {
  return !EXCLUDED_COLUMNS.has(header) && !header.toLowerCase().includes("time");
}

function lookOf(header: string, headers: readonly string[], index: number): SignalLook {
  const look = COLUMN_LOOKS[header];
  if (!look) return { label: header, group: "Outros", digits: 2, color: seriesColor(index) };
  const isOnlyCurrent = header === PEAK_CURRENT_COLUMN && currentColumn(headers) === header;
  return isOnlyCurrent ? { ...look, label: "Corrente", color: CHART_COLOR_CURRENT } : look;
}

export function logSignals(
  headers: readonly string[],
  valuesOf: (header: string) => readonly (number | null)[],
): Signal[] {
  return [...headers]
    .filter(isPlottable)
    .sort((left, right) => pickerRank(left) - pickerRank(right))
    .map((header, index) => ({
      ...lookOf(header, headers, index),
      id: header,
      data: valuesOf(header),
    }));
}

/** Mean current, stick and pack voltage: what a log review almost always needs. */
export function defaultLogSignals(headers: readonly string[]) {
  return [currentColumn(headers), "Comando_Pct", "TensaoTotal_V"]
    .filter((column) => headers.includes(column))
    .map((id) => ({ id, movingAverage: DEFAULT_MOVING_AVERAGE }));
}
