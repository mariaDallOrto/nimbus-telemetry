// CSV log parser for files recorded to the ESP32 SD card. Timestamp/time
// columns stay textual; everything else is coerced to a number when possible
// so charts and moving averages can consume the columns directly.

export type CsvValue = number | string;
export type CsvRow = Record<string, CsvValue>;
export type ParsedCsv = { headers: string[]; rows: CsvRow[] };

function isTimeColumn(header: string): boolean {
  return header === "Timestamp" || header.toLowerCase().includes("time");
}

function cleanHeader(raw: string): string {
  return raw.trim().replace(/['"]+/g, "");
}

const SECONDS_PER_DAY = 86400;
const MIN_ELAPSED_STEP_SECONDS = 0.001;

export class CsvParseError extends Error {}

export function parseCsv(text: string): ParsedCsv {
  const lines = text.trim().split("\n");
  if (lines.length < 2) {
    throw new CsvParseError("Arquivo vazio ou sem linhas de dados.");
  }

  const firstLine = lines[0] ?? "";
  const headers = firstLine.split(",").map(cleanHeader);
  const rows: CsvRow[] = [];

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line || !line.trim()) continue;
    const cells = line.split(",").map((cell) => cell.trim());
    if (cells.length !== headers.length) continue;

    const row: CsvRow = {};
    headers.forEach((header, index) => {
      const raw = cells[index] ?? "";
      if (isTimeColumn(header)) {
        row[header] = raw;
        return;
      }
      const numeric = Number.parseFloat(raw);
      row[header] = Number.isNaN(numeric) ? raw : numeric;
    });
    rows.push(row);
  }

  if (rows.length === 0) {
    throw new CsvParseError("Nenhuma linha válida encontrada. Confira o formato do CSV.");
  }
  return { headers, rows };
}

/** Extract a column as a numeric series (non-numbers become null gaps). */
export function numericColumn(rows: readonly CsvRow[], header: string): (number | null)[] {
  return rows.map((row) => {
    const value = row[header];
    return typeof value === "number" && Number.isFinite(value) ? value : null;
  });
}

/** Whole-second label for a row: ISO `…T14_00_00` → `14:00:00`, else raw text. */
function baseSecond(value: CsvValue | undefined, index: number): string {
  if (typeof value === "string" && value.includes("T")) {
    const [, time] = value.split("T");
    if (time) return time.replace(/_/g, ":");
  }
  return typeof value === "string" || typeof value === "number" ? String(value) : String(index);
}

/** Whole-second X-axis labels (one per row, may repeat within a second). */
export function timeLabels(rows: readonly CsvRow[], timeHeader = "Timestamp"): string[] {
  return rows.map((row, index) => baseSecond(row[timeHeader], index));
}

/** Clock of a row in seconds: `…T14_00_05` → 50405; null when the cell has no time. */
function secondsOfDay(value: CsvValue | undefined): number | null {
  if (typeof value !== "string") return null;
  const match = /(\d{2})[:_](\d{2})[:_](\d{2})/.exec(value);
  if (!match) return null;
  const [, hours = "0", minutes = "0", seconds = "0"] = match;
  return Number(hours) * 3600 + Number(minutes) * 60 + Number(seconds);
}

/**
 * Seconds since the first row, strictly ascending. The firmware timestamps at
 * whole-second resolution but logs several samples per second, so each run of
 * equal-second rows is spread evenly across that second. Interpolation assumes
 * a steady sample rate within the second, which holds for this stream. Rows
 * without a readable time fall back to one second per row.
 */
export function elapsedSeconds(rows: readonly CsvRow[], timeHeader = "Timestamp"): number[] {
  const clocks = rows.map((row) => secondsOfDay(row[timeHeader]));
  if (clocks.some((clock) => clock === null)) return rows.map((_, index) => index);

  const startClock = clocks[0] ?? 0;
  const elapsed: number[] = [];
  let runStart = 0;
  while (runStart < clocks.length) {
    let runEnd = runStart;
    while (runEnd < clocks.length && clocks[runEnd] === clocks[runStart]) runEnd++;
    const clock = clocks[runStart] ?? startClock;
    const secondOfRun =
      clock >= startClock ? clock - startClock : clock - startClock + SECONDS_PER_DAY;
    for (let offset = 0; offset < runEnd - runStart; offset++) {
      const previous = elapsed[elapsed.length - 1] ?? -MIN_ELAPSED_STEP_SECONDS;
      const spread = secondOfRun + offset / (runEnd - runStart);
      elapsed.push(Math.max(spread, previous + MIN_ELAPSED_STEP_SECONDS));
    }
    runStart = runEnd;
  }
  return elapsed;
}
