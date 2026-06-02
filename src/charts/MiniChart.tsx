import { useMemo } from "react";
import type { ChartData, ChartOptions } from "chart.js";
import { AXIS_FONT } from "./chartSetup";
import { CHART_COLOR_GRID_LINE, CHART_COLOR_TEXT_SOFT } from "./chartColors";
import { LineChart } from "./LineChart";

type MiniChartProps = {
  labels: readonly string[];
  data: readonly (number | null)[];
  color: string;
  label: string;
};

/** Compact single-series area chart for the sensor overview grid. */
export function MiniChart({ labels, data, color, label }: MiniChartProps) {
  const chartData = useMemo<ChartData<"line">>(
    () => ({
      labels: [...labels],
      datasets: [
        {
          label,
          data: [...data],
          borderColor: color,
          backgroundColor: `${color}26`,
          borderWidth: 1.5,
          pointRadius: 0,
          fill: true,
          tension: 0.1,
        },
      ],
    }),
    [labels, data, color, label],
  );

  const options = useMemo<ChartOptions<"line">>(
    () => ({
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      plugins: { legend: { display: false } },
      scales: {
        x: { display: false },
        y: {
          ticks: { color: CHART_COLOR_TEXT_SOFT, font: AXIS_FONT, maxTicksLimit: 5 },
          grid: { color: CHART_COLOR_GRID_LINE },
        },
      },
    }),
    [],
  );

  return (
    <LineChart
      data={chartData}
      options={options}
      ariaLabel={`Visão geral: ${label}`}
      variant="mini"
    />
  );
}
