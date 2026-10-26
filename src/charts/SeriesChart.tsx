import { useMemo } from "react";
import type { ChartData, ChartOptions } from "chart.js";
import { AXIS_FONT, LEGEND_FONT } from "./chartSetup";
import { CHART_COLOR_GRID_LINE, CHART_COLOR_TEXT_SOFT } from "./chartColors";
import { LineChart } from "./LineChart";

export type ChartSeries = {
  label: string;
  data: readonly (number | null)[];
  color: string;
  /** Sparse manual readings: draw each value as a dot and connect them across gaps. */
  markers?: boolean;
  /** Series sharing a group share one Y axis even when scales are independent. */
  scaleGroup?: string;
  /** Dashed stroke, for a modelled counterpart of a measured series. */
  dashed?: boolean;
  /** Thin dotted constant, for a threshold or target drawn against the data. */
  reference?: boolean;
  /** Unit printed as the title of this series' Y axis when scales are shown. */
  unit?: string;
  /** Fixed [min, max] for this series' Y axis, for bounded quantities like a percentage. */
  range?: readonly [number, number];
  /** Floor for this series' Y axis, for quantities that cannot go negative. */
  min?: number;
  /** Large diamond markers with no line, to call out a single computed point. */
  highlight?: boolean;
};

function axisId(entry: ChartSeries, index: number): string {
  return `y${entry.scaleGroup ?? index}`;
}

type SeriesChartProps = {
  labels: readonly string[];
  series: readonly ChartSeries[];
  ariaLabel: string;
  /**
   * When true each series gets its own auto-fitted (hidden) Y axis, so a large
   * quantity like RPM no longer flattens small ones like current or voltage.
   * When false every series shares one Y axis (absolute comparison).
   */
  independentScales?: boolean;
  /** Draw chart.js's legend; turn off when the page already has series toggles. */
  legend?: boolean;
  /**
   * With independent scales, draw every axis with its numbers, unit title and
   * the color of its first series, alternating left and right.
   */
  showScales?: boolean;
  /** Label and grid only every Nth category, e.g. 10 on a 0–100 % axis. */
  xTickEvery?: number;
  /** Title under the X axis. */
  xTitle?: string;
};

/** Multi-series line chart for the analysis tab's custom selection. */
export function SeriesChart({
  labels,
  series,
  ariaLabel,
  independentScales = false,
  legend = true,
  showScales = false,
  xTickEvery,
  xTitle,
}: SeriesChartProps) {
  const data = useMemo<ChartData<"line">>(
    () => ({
      labels: [...labels],
      datasets: series.map((entry, index) => ({
        label: entry.label,
        data: [...entry.data],
        borderColor: entry.color,
        backgroundColor: entry.color,
        borderWidth: entry.reference ? 1.25 : 1.5,
        borderDash: entry.reference ? [2, 4] : entry.dashed ? [6, 4] : [],
        pointRadius: entry.highlight ? 8 : entry.markers ? 4 : 0,
        pointHoverRadius: entry.reference ? 0 : entry.highlight ? 9 : entry.markers ? 5 : 3,
        pointStyle: entry.highlight ? ("rectRot" as const) : ("circle" as const),
        showLine: !entry.highlight,
        spanGaps: entry.markers ?? false,
        tension: 0.1,
        yAxisID: independentScales ? axisId(entry, index) : "y",
      })),
    }),
    [labels, series, independentScales],
  );

  const options = useMemo<ChartOptions<"line">>(() => {
    const scales: NonNullable<ChartOptions<"line">["scales"]> = {
      x: {
        ticks: {
          color: CHART_COLOR_TEXT_SOFT,
          font: AXIS_FONT,
          ...(xTickEvery
            ? {
                autoSkip: false,
                maxRotation: 0,
                callback: (_value: unknown, index: number) =>
                  index % xTickEvery === 0 ? String(index) : null,
              }
            : { maxTicksLimit: 12, ...(showScales ? { maxRotation: 0 } : {}) }),
        },
        grid: {
          color: xTickEvery
            ? (ctx) => (ctx.index % xTickEvery === 0 ? CHART_COLOR_GRID_LINE : "transparent")
            : CHART_COLOR_GRID_LINE,
        },
        title: {
          display: xTitle != null,
          text: xTitle ?? "",
          color: CHART_COLOR_TEXT_SOFT,
          font: AXIS_FONT,
        },
      },
    };
    if (independentScales) {
      // One axis per scale group. Hidden mode keeps only the first axis for
      // gridlines and leaves exact values to the tooltip.
      const groups = new Map<string, ChartSeries>();
      series.forEach((entry, index) => {
        const id = axisId(entry, index);
        if (!groups.has(id)) groups.set(id, entry);
      });
      [...groups].forEach(([id, first], index) => {
        scales[id] = showScales
          ? {
              type: "linear",
              position: index % 2 === 0 ? "left" : "right",
              ...(first.range
                ? { min: first.range[0], max: first.range[1] }
                : { grace: "8%", min: first.min }),
              ticks: { color: first.color, font: AXIS_FONT, maxTicksLimit: 6, padding: 4 },
              title: {
                display: first.unit != null,
                text: first.unit ?? "",
                color: first.color,
                font: AXIS_FONT,
                padding: 2,
              },
              border: { color: first.color },
              grid: { color: CHART_COLOR_GRID_LINE, drawOnChartArea: index === 0 },
            }
          : {
              type: "linear",
              position: "left",
              display: index === 0,
              grace: "8%",
              ticks: { display: false },
              grid: { color: CHART_COLOR_GRID_LINE, drawOnChartArea: index === 0 },
            };
      });
    } else {
      scales["y"] = {
        ticks: { color: CHART_COLOR_TEXT_SOFT, font: AXIS_FONT },
        grid: { color: CHART_COLOR_GRID_LINE },
      };
    }
    return {
      locale: "pt-BR",
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      interaction: { mode: "index", intersect: false },
      plugins: {
        legend: {
          display: legend,
          position: "top",
          align: "end",
          labels: {
            color: CHART_COLOR_TEXT_SOFT,
            font: LEGEND_FONT,
            boxWidth: 10,
            boxHeight: 10,
            usePointStyle: true,
          },
        },
      },
      scales,
    };
  }, [independentScales, series, legend, showScales, xTickEvery, xTitle]);

  return <LineChart data={data} options={options} ariaLabel={ariaLabel} zoomable zoomMode="x" />;
}
