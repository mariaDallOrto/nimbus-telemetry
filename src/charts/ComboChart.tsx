import { useMemo } from "react";
import type { ChartData, ChartOptions } from "chart.js";
import type { AxisBounds } from "../telemetry/axis";
import { AXIS_FONT, LEGEND_FONT } from "./chartSetup";
import {
  CHART_COLOR_CURRENT,
  CHART_COLOR_GRID_LINE,
  CHART_COLOR_RPM,
  CHART_COLOR_STICK,
  CHART_COLOR_TEXT_SOFT,
} from "./chartColors";
import { LineChart } from "./LineChart";

type ComboChartProps = {
  labels: readonly string[];
  stick: readonly (number | null)[];
  current: readonly (number | null)[];
  rpm: readonly (number | null)[];
  currentBounds: AxisBounds | null;
  rpmBounds: AxisBounds | null;
};

/** Live triple-axis chart: stick command (%), motor current (A), estimated RPM. */
export function ComboChart({
  labels,
  stick,
  current,
  rpm,
  currentBounds,
  rpmBounds,
}: ComboChartProps) {
  const data = useMemo<ChartData<"line">>(
    () => ({
      labels: [...labels],
      datasets: [
        {
          label: "Stick (%)",
          data: [...stick],
          borderColor: CHART_COLOR_STICK,
          backgroundColor: `${CHART_COLOR_STICK}1a`,
          yAxisID: "yStick",
          fill: true,
          pointRadius: 0,
          borderWidth: 2,
          spanGaps: true,
        },
        {
          label: "Corrente (A)",
          data: [...current],
          borderColor: CHART_COLOR_CURRENT,
          yAxisID: "yCurrent",
          pointRadius: 0,
          borderWidth: 2,
          spanGaps: true,
        },
        {
          label: "RPM",
          data: [...rpm],
          borderColor: CHART_COLOR_RPM,
          yAxisID: "yRpm",
          pointRadius: 0,
          borderWidth: 2,
          borderDash: [5, 5],
          spanGaps: true,
        },
      ],
    }),
    [labels, stick, current, rpm],
  );

  const options = useMemo<ChartOptions<"line">>(
    () => ({
      responsive: true,
      maintainAspectRatio: false,
      // Live data: kill animation so points slot in without easing wobble, and
      // normalize since the series are already sorted/uniform.
      animation: false,
      normalized: true,
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
        tooltip: { animation: false },
      },
      scales: {
        x: {
          ticks: {
            color: CHART_COLOR_TEXT_SOFT,
            font: AXIS_FONT,
            maxRotation: 0,
            autoSkip: true,
            autoSkipPadding: 16,
            maxTicksLimit: 6,
          },
          grid: { color: CHART_COLOR_GRID_LINE },
        },
        yStick: {
          type: "linear",
          position: "left",
          min: -100,
          max: 100,
          ticks: { color: CHART_COLOR_STICK, font: AXIS_FONT },
          grid: { color: CHART_COLOR_GRID_LINE },
        },
        yCurrent: {
          type: "linear",
          position: "right",
          // Anchor the baseline at 0 (current rarely goes negative) so only the
          // ceiling moves — half as much vertical jitter as a floating axis.
          min: currentBounds ? Math.min(0, currentBounds.min) : 0,
          ...(currentBounds ? { max: currentBounds.max } : {}),
          ticks: { color: CHART_COLOR_CURRENT, font: AXIS_FONT },
          grid: { drawOnChartArea: false },
        },
        yRpm: {
          type: "linear",
          position: "right",
          ...(rpmBounds ? { min: rpmBounds.min, max: rpmBounds.max } : {}),
          ticks: { color: CHART_COLOR_RPM, font: AXIS_FONT },
          grid: { drawOnChartArea: false },
        },
      },
    }),
    [currentBounds, rpmBounds],
  );

  return (
    <LineChart
      data={data}
      options={options}
      ariaLabel="Gráfico ao vivo: stick, corrente e RPM"
      zoomable
      zoomMode="x"
    />
  );
}
