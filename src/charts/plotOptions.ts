import uPlot from "uplot";
import { stickyBounds, type AxisBounds } from "../telemetry/axis";
import { CHART_COLOR_GRID_LINE, CHART_COLOR_TEXT_SOFT } from "./chartColors";

export type ChartSeries = {
  label: string;
  data: readonly (number | null)[];
  color: string;
  /** Sparse manual readings: draw each value as a dot and connect them across gaps. */
  markers?: boolean;
  /** Series sharing a group share one Y axis. */
  scaleGroup?: string;
  /** Dashed stroke, for a modelled counterpart of a measured series. */
  dashed?: boolean;
  /** Thin dotted constant, for a threshold or target drawn against the data. */
  reference?: boolean;
  /** Unit printed as the title of this series' Y axis. */
  unit?: string;
  /** Fixed [min, max] for this series' Y axis, for bounded quantities like a percentage. */
  range?: readonly [number, number];
  /** Floor for this series' Y axis, for quantities that cannot go negative. */
  min?: number;
  /** Large diamond markers with no line, to call out a single computed point. */
  highlight?: boolean;
};

export type PlotOptions = Omit<uPlot.Options, "width" | "height">;

type XAxis = {
  format: (value: number) => string;
  /** Candidate tick steps in X units, e.g. multiples of a second or a percentage step. */
  steps: readonly number[];
  title?: string;
};

type PlotOptionsInput = {
  series: readonly Omit<ChartSeries, "data">[];
  xAxis: XAxis;
  /** Every series on one axis, for absolute comparison. */
  sharedScale?: boolean;
  /** Node that receives uPlot's legend, outside the plot so it never covers the lines. */
  legendMount?: () => HTMLElement | null;
  /** Streaming chart: calm auto-ranged axes and sub-pixel lines that do not jitter. */
  live?: boolean;
  plugins?: uPlot.Plugin[];
};

const AXIS_FONT = '11px "Geist Mono", ui-monospace, monospace';
const AXIS_TITLE_FONT = '500 11px "Geist Mono", ui-monospace, monospace';
const AXIS_TITLE_PX = 18;
const AXIS_CHAR_PX = 6.8;
const AXIS_GAP_PX = 5;
const AXIS_TICK_PX = 4;
const AXIS_MIN_WIDTH_PX = 34;
const X_AXIS_HEIGHT_PX = 30;
const Y_TICK_SPACING_PX = 36;
const X_TICK_SPACING_PX = 72;
const RANGE_PADDING = 0.1;
const MARKER_PX = 8;
const DIAMOND_PX = 16;
const LINE_WIDTH_PX = 1.5;
const REFERENCE_WIDTH_PX = 1.25;
const FOCUS_RADIUS_PX = 24;
const UNFOCUSED_ALPHA = 0.35;
const SIDE_RIGHT = 1;
const SIDE_LEFT = 3;

const TICK_NUMBER = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 2 });

export const SECOND_TICK_STEPS = [1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 900, 1800, 3600] as const;
export const ELAPSED_TICK_STEPS = [0.1, 0.2, 0.5, ...SECOND_TICK_STEPS] as const;

/** `1:05`, or `1:05.5` when zoomed below the second. */
export function formatElapsed(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds - minutes * 60;
  const isWholeSecond = Math.abs(remainder - Math.round(remainder)) < 0.001;
  const text = isWholeSecond
    ? String(Math.round(remainder)).padStart(2, "0")
    : remainder.toFixed(1).padStart(4, "0");
  return `${minutes}:${text}`;
}

export function formatClock(epochSeconds: number): string {
  return new Date(epochSeconds * 1000).toLocaleTimeString("pt-BR");
}

function scaleKey(group: string | undefined, index: number, sharedScale: boolean): string {
  return sharedScale ? "y" : `y:${group ?? index}`;
}

/** Fits the widest tick label, so a scale is never clipped or left out. */
function yAxisWidth(_plot: uPlot, ticks: string[] | null): number {
  const longest = Math.max(0, ...(ticks ?? []).map((tick) => tick.length));
  const width = Math.ceil(longest * AXIS_CHAR_PX) + AXIS_GAP_PX + AXIS_TICK_PX;
  return Math.max(AXIS_MIN_WIDTH_PX, width);
}

/** Auto-fitting every frame makes a live axis jump; sticky bounds grow fast and shrink lazily. */
function stickyRange(): uPlot.Range.Function {
  const boundsByScale = new Map<string, AxisBounds | null>();
  return (_plot, dataMin, dataMax, key) => {
    const bounds = stickyBounds(boundsByScale.get(key) ?? null, [dataMin, dataMax]);
    boundsByScale.set(key, bounds);
    return bounds ? [bounds.min, bounds.max] : [0, 1];
  };
}

function yScale(entry: Omit<ChartSeries, "data">, range: uPlot.Range.Function | null): uPlot.Scale {
  if (entry.range) return { auto: false, range: [entry.range[0], entry.range[1]] };
  if (range) return { range };
  if (entry.min === undefined) return {};
  return {
    range: { min: { pad: RANGE_PADDING, hard: entry.min }, max: { pad: RANGE_PADDING } },
  };
}

function yAxis(
  entry: Omit<ChartSeries, "data"> | undefined,
  scale: string,
  index: number,
): uPlot.Axis {
  return {
    scale,
    side: index % 2 === 0 ? SIDE_LEFT : SIDE_RIGHT,
    size: yAxisWidth,
    gap: AXIS_GAP_PX,
    font: AXIS_FONT,
    labelFont: AXIS_TITLE_FONT,
    labelSize: AXIS_TITLE_PX,
    labelGap: 0,
    space: Y_TICK_SPACING_PX,
    stroke: entry?.color ?? CHART_COLOR_TEXT_SOFT,
    ...(entry?.unit ? { label: entry.unit } : {}),
    grid: { show: index === 0, stroke: CHART_COLOR_GRID_LINE, width: 1 },
    ticks: { stroke: CHART_COLOR_GRID_LINE, width: 1, size: AXIS_TICK_PX },
    values: (_plot, ticks) => ticks.map((tick) => TICK_NUMBER.format(tick)),
  };
}

function plotSeries(
  entry: Omit<ChartSeries, "data">,
  index: number,
  sharedScale: boolean,
): uPlot.Series {
  return {
    label: entry.label,
    scale: scaleKey(entry.scaleGroup, index, sharedScale),
    stroke: entry.color,
    width: entry.reference ? REFERENCE_WIDTH_PX : LINE_WIDTH_PX,
    spanGaps: entry.markers ?? false,
    ...(entry.reference ? { dash: [2, 4] } : entry.dashed ? { dash: [6, 4] } : {}),
    ...(entry.highlight ? { paths: () => null } : {}),
    points: entry.highlight
      ? { show: true, paths: diamondPoints, fill: entry.color, stroke: entry.color }
      : { show: entry.markers ?? false, size: MARKER_PX, fill: entry.color, stroke: entry.color },
    value: (_plot, value) => (value == null ? "—" : TICK_NUMBER.format(value)),
  };
}

const diamondPoints: uPlot.Series.Points.PathBuilder = (
  plot,
  seriesIndex,
  firstIndex,
  lastIndex,
) => {
  const scale = plot.series[seriesIndex]?.scale ?? "y";
  const ys = plot.data[seriesIndex] ?? [];
  const xs = plot.data[0];
  const radius = (DIAMOND_PX * uPlot.pxRatio) / 2;
  const path = new Path2D();
  for (let index = firstIndex; index <= lastIndex; index++) {
    const y = ys[index];
    const x = xs[index];
    if (y == null || x == null) continue;
    const left = plot.valToPos(x, "x", true);
    const top = plot.valToPos(y, scale, true);
    path.moveTo(left, top - radius);
    path.lineTo(left + radius, top);
    path.lineTo(left, top + radius);
    path.lineTo(left - radius, top);
    path.closePath();
  }
  return { fill: path, stroke: path };
};

/** Turns chart intent into uPlot options: one colored, always visible axis per scale. */
export function buildPlotOptions({
  series,
  xAxis,
  sharedScale = false,
  legendMount,
  live = false,
  plugins = [],
}: PlotOptionsInput): PlotOptions {
  const liveRange = live ? stickyRange() : null;
  const axisOwners = new Map<string, Omit<ChartSeries, "data">>();
  series.forEach((entry, index) => {
    const key = scaleKey(entry.scaleGroup, index, sharedScale);
    if (!axisOwners.has(key)) axisOwners.set(key, entry);
  });

  const scales: uPlot.Scales = { x: { time: false } };
  for (const [key, owner] of axisOwners) scales[key] = sharedScale ? {} : yScale(owner, liveRange);

  return {
    plugins,
    padding: [10, 6, 0, 6],
    ...(live ? { pxAlign: false } : {}),
    legend: {
      show: legendMount !== undefined,
      live: true,
      ...(legendMount ? { mount: (_plot, legend) => legendMount()?.replaceChildren(legend) } : {}),
    },
    focus: { alpha: UNFOCUSED_ALPHA },
    cursor: {
      drag: { x: true, y: false, setScale: true },
      focus: { prox: FOCUS_RADIUS_PX },
      points: { size: MARKER_PX },
    },
    scales,
    series: [
      { label: xAxis.title ?? "x", value: (_plot, x) => (x == null ? "—" : xAxis.format(x)) },
      ...series.map((entry, index) => plotSeries(entry, index, sharedScale)),
    ],
    axes: [
      {
        font: AXIS_FONT,
        labelFont: AXIS_TITLE_FONT,
        stroke: CHART_COLOR_TEXT_SOFT,
        size: X_AXIS_HEIGHT_PX,
        space: X_TICK_SPACING_PX,
        incrs: [...xAxis.steps],
        grid: { stroke: CHART_COLOR_GRID_LINE, width: 1 },
        ticks: { stroke: CHART_COLOR_GRID_LINE, width: 1, size: AXIS_TICK_PX },
        values: (_plot, ticks) => ticks.map(xAxis.format),
        ...(xAxis.title ? { label: xAxis.title, labelSize: AXIS_TITLE_PX } : {}),
      },
      ...[...axisOwners].map(([key, owner], index) =>
        yAxis(sharedScale ? undefined : owner, key, index),
      ),
    ],
  };
}
