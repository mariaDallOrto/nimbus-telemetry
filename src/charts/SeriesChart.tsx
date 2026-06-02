import { useMemo } from "react";
import type { ChartData, ChartOptions } from "chart.js";
import { AXIS_FONT, LEGEND_FONT } from "./chartSetup";
import { CHART_COLOR_GRID_LINE, CHART_COLOR_TEXT_SOFT } from "./chartColors";
import { LineChart } from "./LineChart";

export type ChartSeries = {
  label: string;
  data: readonly (number | null)[];
  color: string;
};

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
};

/** Multi-series line chart for the analysis tab's custom selection. */
export function SeriesChart({
  labels,
  series,
  ariaLabel,
  independentScales = false,
}: SeriesChartProps) {
  const data = useMemo<ChartData<"line">>(
    () => ({
      labels: [...labels],
      datasets: series.map((entry, index) => ({
        label: entry.label,
        data: [...entry.data],
        borderColor: entry.color,
        backgroundColor: entry.color,
        borderWidth: 1.5,
        pointRadius: 0,
        tension: 0.1,
        yAxisID: independentScales ? `y${index}` : "y",
      })),
    }),
    [labels, series, independentScales],
  );

  const options = useMemo<ChartOptions<"line">>(() => {
    const scales: NonNullable<ChartOptions<"line">["scales"]> = {
      x: {
        ticks: { color: CHART_COLOR_TEXT_SOFT, font: AXIS_FONT, maxTicksLimit: 12 },
        grid: { color: CHART_COLOR_GRID_LINE },
      },
    };
    if (independentScales) {
      // Per-series hidden axes. Only the first draws gridlines (visual
      // structure); numbers are hidden since each series has its own scale —
      // exact values stay available in the tooltip.
      series.forEach((_, index) => {
        scales[`y${index}`] = {
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
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      interaction: { mode: "index", intersect: false },
      plugins: {
        legend: {
          display: true,
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
  }, [independentScales, series]);

  return <LineChart data={data} options={options} ariaLabel={ariaLabel} zoomable zoomMode="x" />;
}
