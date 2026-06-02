// Domain types for the ESP32 telemetry link (R84 receiver + HSTS016L ESC).
// The firmware streams two JSON shapes over the WebSocket: periodic samples
// and recording/receiver STATUS frames. We normalize both into typed values
// at the edge (see parseTelemetryMessage) so the UI never touches `unknown`.

export const CELL_KEYS = ["c1", "c2", "c3", "c4", "c5", "c6"] as const;
export type CellKey = (typeof CELL_KEYS)[number];

/** A single normalized telemetry reading. `rssi` is null when absent. */
export type TelemetrySample = {
  rssi: number | null;
  /** Throttle stick command, percent (firmware `pwmVal`). */
  stickPct: number;
  /** Pack voltage in volts (firmware `vTotal`). */
  voltage: number;
  /** Motor current in amps. */
  current: number;
  /** Per-cell voltages; null for cells the frame omitted. */
  cells: Record<CellKey, number | null>;
};

export type RecordingPhase = "started" | "stopped";

/** Normalized SD-recording + receiver-mode status frame. */
export type RecordingStatus = {
  phase: RecordingPhase;
  file: string;
  rxMode: string | null;
};

export type TelemetryMessage =
  | { kind: "sample"; sample: TelemetrySample }
  | { kind: "status"; status: RecordingStatus };

/** Connection lifecycle surfaced to the UI for system-status visibility. */
export type ConnectionStatus = "offline" | "connecting" | "online" | "reconnecting";

export type MotorConfig = {
  /** ESP32 access-point IP, e.g. "192.168.4.1". */
  ip: string;
  /** Motor velocity constant (KV), rpm per volt. */
  kv: number;
  /** Winding resistance in ohms, for the RPM estimate. */
  resistance: number;
  /** Gearbox reduction ratio (motor : output shaft). 1 = direct drive. */
  reduction: number;
};
