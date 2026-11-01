import { CSV_LOG_HEADER, formatLogTimestamp } from "./csvLog";

// Deterministic fake session in the SD log layout, so charts can be exercised
// without hardware. It walks through what a real log contains: idle, a ramp,
// fight-style punches, a battery sagging under load, a Wi-Fi fade, lost packets
// and sparse clamp-meter readings.

const SAMPLES_PER_SECOND = 20;
const DURATION_SECONDS = 120;
const CELL_COUNT = 4;
const FULL_CELL_VOLTS = 4.18;
const SAG_VOLTS_PER_CELL = 0.3;
const PACK_RESISTANCE_OHMS = 0.022;
const FULL_STICK_AMPS = 62;
const CURRENT_LAG = 0.12;
const LOST_PACKETS = { fromSecond: 86, toSecond: 89 };
const WIFI_FADE = { fromSecond: 60, toSecond: 80 };
const CLAMP_EVERY_SECONDS = 15;
const START = new Date(2026, 9, 31, 10, 0, 0);

type StickPhase = { untilSecond: number; stickAt: (seconds: number) => number };

const STICK_PHASES: readonly StickPhase[] = [
  { untilSecond: 8, stickAt: () => 0 },
  { untilSecond: 28, stickAt: (seconds) => ((seconds - 8) / 20) * 100 },
  { untilSecond: 36, stickAt: () => 100 },
  { untilSecond: 44, stickAt: () => 0 },
  { untilSecond: 84, stickAt: (seconds) => (Math.floor(seconds / 3) % 2 === 0 ? 100 : 25) },
  { untilSecond: 104, stickAt: () => 50 },
  { untilSecond: DURATION_SECONDS, stickAt: () => 0 },
];

/** mulberry32: a small seeded generator, so every run draws the same chart. */
function seededRandom(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let mixed = Math.imul(state ^ (state >>> 15), 1 | state);
    mixed = (mixed + Math.imul(mixed ^ (mixed >>> 7), 61 | mixed)) ^ mixed;
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296;
  };
}

function stickAt(seconds: number): number {
  const phase = STICK_PHASES.find((candidate) => seconds < candidate.untilSecond);
  return phase ? phase.stickAt(seconds) : 0;
}

function isWithin(seconds: number, span: { fromSecond: number; toSecond: number }): boolean {
  return seconds >= span.fromSecond && seconds < span.toSecond;
}

export function generateMockLog(seed = 14): string {
  const random = seededRandom(seed);
  const noise = (amplitude: number) => (random() - 0.5) * 2 * amplitude;
  const lines = [`${CSV_LOG_HEADER},Alicate_A`];
  let current = 0;

  for (let sample = 0; sample < DURATION_SECONDS * SAMPLES_PER_SECOND; sample++) {
    const seconds = sample / SAMPLES_PER_SECOND;
    const stick = stickAt(seconds);
    const targetCurrent = (stick / 100) ** 2 * FULL_STICK_AMPS;
    current += (targetCurrent - current) * CURRENT_LAG;
    if (isWithin(seconds, LOST_PACKETS)) continue;

    const mean = Math.max(0, current + noise(0.6));
    const ripple = 0.8 + mean * 0.25;
    const restCell = FULL_CELL_VOLTS - (seconds / DURATION_SECONDS) * SAG_VOLTS_PER_CELL;
    const packVolts = restCell * CELL_COUNT - mean * PACK_RESISTANCE_OHMS + noise(0.02);
    const cells = Array.from({ length: 6 }, (_, cell) =>
      cell < CELL_COUNT ? (packVolts / CELL_COUNT + (cell - 1.5) * 0.01).toFixed(3) : "0.000",
    );
    const rssi = (isWithin(seconds, WIFI_FADE) ? -72 : -44) + noise(3);
    const isClampReading = sample % (CLAMP_EVERY_SECONDS * SAMPLES_PER_SECOND) === 0 && stick > 0;
    const at = new Date(START.getTime() + seconds * 1000);

    lines.push(
      [
        formatLogTimestamp(at),
        sample + 1,
        rssi.toFixed(0),
        (mean + ripple).toFixed(2),
        stick.toFixed(0),
        packVolts.toFixed(2),
        CELL_COUNT,
        ...cells,
        mean.toFixed(2),
        (mean - ripple).toFixed(2),
        Math.round(19 + noise(2)),
        Math.round(10 + noise(9)),
        isClampReading ? (mean * 1.03).toFixed(1) : "",
      ].join(","),
    );
  }
  return lines.join("\n");
}
