// Hex literals for chart.js (canvas can't resolve CSS custom properties).
// Each MUST stay 1:1 with its --color-* token in src/styles.css.

export const CHART_COLOR_STICK = "#c7a6ff";
export const CHART_COLOR_CURRENT = "#ff5c7c";
export const CHART_COLOR_RPM = "#ff9f45";
export const CHART_COLOR_VOLTAGE = "#34d399";
export const CHART_COLOR_RSSI = "#5ea8ff";

export const CHART_COLOR_TEXT_SOFT = "#a8a8a8";
export const CHART_COLOR_GRID_LINE = "#2e2e2e";

/** Cyclic palette for user-selected analysis columns. */
export const CHART_SERIES_PALETTE = [
  "#ffbc00",
  "#5ea8ff",
  "#ff5c7c",
  "#34d399",
  "#c7a6ff",
  "#ff9f45",
  "#7ad7c4",
  "#f7768e",
] as const;

export function seriesColor(index: number): string {
  return CHART_SERIES_PALETTE[index % CHART_SERIES_PALETTE.length] ?? CHART_SERIES_PALETTE[0];
}
