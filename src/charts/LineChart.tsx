import { Suspense, lazy } from "react";
import type { ChartData, ChartOptions } from "chart.js";
import { ensureChartsRegistered } from "./chartSetup";

const Line = lazy(async () => {
  const [chartModule] = await Promise.all([import("react-chartjs-2"), ensureChartsRegistered()]);
  return { default: chartModule.Line };
});

type LineChartProps = {
  data: ChartData<"line">;
  options: ChartOptions<"line">;
  ariaLabel: string;
  variant?: "default" | "mini";
};

export function LineChart({ data, options, ariaLabel, variant = "default" }: LineChartProps) {
  return (
    <figure
      className={`nt-chart-frame${variant === "mini" ? " nt-chart-frame--mini" : ""}`}
      role="img"
      aria-label={ariaLabel}
    >
      <Suspense fallback={null}>
        <Line data={data} options={options} />
      </Suspense>
    </figure>
  );
}
