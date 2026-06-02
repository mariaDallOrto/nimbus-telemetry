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

/** Build the X-axis labels, shortening ISO timestamps to a readable time. */
export function timeLabels(rows: readonly CsvRow[], timeHeader = "Timestamp"): string[] {
  return rows.map((row, index) => {
    const value = row[timeHeader];
    if (typeof value === "string" && value.includes("T")) {
      const [, time] = value.split("T");
      if (time) return time.replace(/_/g, ":");
    }
    return typeof value === "string" || typeof value === "number" ? String(value) : String(index);
  });
}
