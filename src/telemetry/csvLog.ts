import { CELL_KEYS, type TelemetrySample } from "./types";

// Same layout the firmware writes to the SD card, so the analysis page reads
// browser-recorded logs and SD logs interchangeably.
export const CSV_LOG_HEADER =
  "Timestamp,PacketID,RSSI_dBm,Corrente_A,Comando_Pct,TensaoTotal_V,Celulas_N,C1,C2,C3,C4,C5,C6,Corrente_Med_A,Corrente_Min_A,LoopMs,PwmIdleMs";

function fixedOrEmpty(value: number | null, digits: number): string {
  return value === null ? "" : value.toFixed(digits);
}

function twoDigits(value: number): string {
  return String(value).padStart(2, "0");
}

export function formatLogTimestamp(at: Date): string {
  const date = `${at.getFullYear()}-${twoDigits(at.getMonth() + 1)}-${twoDigits(at.getDate())}`;
  const time = [at.getHours(), at.getMinutes(), at.getSeconds()].map(twoDigits).join("_");
  return `${date}T${time}`;
}

export function formatCsvLogLine(sample: TelemetrySample, at: Date): string {
  return [
    formatLogTimestamp(at),
    fixedOrEmpty(sample.packetId, 0),
    fixedOrEmpty(sample.rssi, 0),
    fixedOrEmpty(sample.currentPeak, 2),
    sample.stickPct.toFixed(0),
    sample.voltage.toFixed(2),
    fixedOrEmpty(sample.nCells, 0),
    ...CELL_KEYS.map((key) => fixedOrEmpty(sample.cells[key], 3)),
    sample.current.toFixed(2),
    fixedOrEmpty(sample.currentMin, 2),
    fixedOrEmpty(sample.loopMs, 0),
    fixedOrEmpty(sample.pwmAgeMs, 0),
  ].join(",");
}
