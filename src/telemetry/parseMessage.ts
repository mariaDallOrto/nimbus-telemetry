import { CELL_KEYS, type CellKey, type TelemetryMessage, type TelemetrySample } from "./types";

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : null;
}

function asNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function readCells(frame: Record<string, unknown>): Record<CellKey, number | null> {
  const cells = {} as Record<CellKey, number | null>;
  for (const key of CELL_KEYS) cells[key] = asNumber(frame[key]);
  return cells;
}

/**
 * Normalize one raw WebSocket payload into a typed message.
 * Returns null for malformed frames (caller ignores them) so a single bad
 * packet never crashes the live view.
 */
export function parseTelemetryMessage(raw: string): TelemetryMessage | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  const frame = asRecord(parsed);
  if (!frame) return null;

  if (frame["type"] === "STATUS") {
    const recState = frame["recState"];
    const phase = recState === "STARTED" ? "started" : recState === "STOPPED" ? "stopped" : null;
    if (!phase) return null;
    const rxMode = frame["rxMode"];
    return {
      kind: "status",
      status: {
        phase,
        file: typeof frame["file"] === "string" ? frame["file"] : "",
        rxMode: typeof rxMode === "string" ? rxMode : null,
      },
    };
  }

  const voltage = asNumber(frame["vTotal"]);
  const current = asNumber(frame["current"]);
  const stickPct = asNumber(frame["pwmVal"]);
  if (voltage === null || current === null || stickPct === null) return null;

  const sample: TelemetrySample = {
    rssi: asNumber(frame["rssi"]),
    stickPct,
    voltage,
    current,
    cells: readCells(frame),
  };
  return { kind: "sample", sample };
}
