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
};

/** Multi-series line chart for the analysis tab's custom selection. */
export function SeriesChart({ labels, series, ariaLabel }: SeriesChartProps) {
  const data = useMemo<ChartData<"line">>(
    () => ({
      labels: [...labels],
      datasets: series.map((entry) => ({
        label: entry.label,
        data: [...entry.data],
        borderColor: entry.color,
        backgroundColor: entry.color,
        borderWidth: 1.5,
        pointRadius: 0,
        tension: 0.1,
      })),
    }),
    [labels, series],
  );

  const options = useMemo<ChartOptions<"line">>(
    () => ({
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
      scales: {
        x: {
          ticks: { color: CHART_COLOR_TEXT_SOFT, font: AXIS_FONT, maxTicksLimit: 12 },
          grid: { color: CHART_COLOR_GRID_LINE },
        },
        y: {
          ticks: { color: CHART_COLOR_TEXT_SOFT, font: AXIS_FONT },
          grid: { color: CHART_COLOR_GRID_LINE },
        },
      },
    }),
    [],
  );

  return <LineChart data={data} options={options} ariaLabel={ariaLabel} zoomable zoomMode="x" />;
}
