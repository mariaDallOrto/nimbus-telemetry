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

/**
 * Sub-second X-axis labels. The firmware timestamps at whole-second resolution
 * but logs several samples per second, so many rows share the same label and
 * the chart looks time-compressed. We recover temporal resolution by spreading
 * each run of equal-second rows evenly across that second
 * (`14:00:00.000 … 14:00:00.900`). Interpolation assumes a steady sample rate
 * within the second — which holds for this telemetry stream.
 */
export function temporalLabels(rows: readonly CsvRow[], timeHeader = "Timestamp"): string[] {
  const bases = rows.map((row, index) => baseSecond(row[timeHeader], index));
  const labels: string[] = [];

  let runStart = 0;
  while (runStart < bases.length) {
    let runEnd = runStart;
    while (runEnd < bases.length && bases[runEnd] === bases[runStart]) runEnd++;
    const runLength = runEnd - runStart;
    const base = bases[runStart] ?? String(runStart);
    for (let offset = 0; offset < runLength; offset++) {
      if (runLength > 1) {
        const millis = Math.round((offset / runLength) * 1000);
        labels.push(`${base}.${String(millis).padStart(3, "0")}`);
      } else {
        labels.push(base);
      }
    }
    runStart = runEnd;
  }
  return labels;
}
