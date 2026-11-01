import { useMemo, useRef, useState } from "react";
import type uPlot from "uplot";
import { ChartFrame } from "./ChartFrame";
import { buildPlotOptions, type ChartSeries } from "./plotOptions";
import { resetZoom, UPlotChart } from "./UPlotChart";
import { wheelZoomPlugin } from "./wheelZoom";

type SeriesChartProps = {
  x: readonly number[];
  series: readonly ChartSeries[];
  ariaLabel: string;
  formatX: (value: number) => string;
  xSteps: readonly number[];
  /** Each series group on its own axis; otherwise all of them share one. */
  independentScales?: boolean;
  /** Draw uPlot's legend; turn off when the page already has series toggles. */
  legend?: boolean;
  /** Title under the X axis. */
  xTitle?: string;
};

/** Multi-series line chart for the energy page. */
export function SeriesChart({
  x,
  series,
  ariaLabel,
  formatX,
  xSteps,
  independentScales = false,
  legend = true,
  xTitle,
}: SeriesChartProps) {
  const plotRef = useRef<uPlot | null>(null);
  const legendRef = useRef<HTMLDivElement>(null);
  const [isZoomed, setIsZoomed] = useState(false);

  const options = useMemo(
    () =>
      buildPlotOptions({
        series,
        xAxis: { format: formatX, steps: xSteps, ...(xTitle ? { title: xTitle } : {}) },
        sharedScale: !independentScales,
        ...(legend ? { legendMount: () => legendRef.current } : {}),
        plugins: [wheelZoomPlugin()],
      }),
    [series, formatX, xSteps, xTitle, independentScales, legend],
  );
  const data = useMemo<uPlot.AlignedData>(
    () => [[...x], ...series.map((entry) => [...entry.data])],
    [x, series],
  );

  return (
    <ChartFrame
      header={legend ? <div ref={legendRef} className="nt-chart-legend" /> : null}
      isZoomed={isZoomed}
      onResetZoom={() => resetZoom(plotRef.current)}
    >
      <UPlotChart
        options={options}
        data={data}
        ariaLabel={ariaLabel}
        plotRef={plotRef}
        onZoomChange={setIsZoomed}
      />
    </ChartFrame>
  );
}
