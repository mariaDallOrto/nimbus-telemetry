let registered = false;

/** Register only the chart.js pieces the dashboard uses, once, lazily. */
export async function ensureChartsRegistered(): Promise<void> {
  if (registered) return;
  const {
    CategoryScale,
    Chart: ChartJsCore,
    Filler,
    Legend,
    LinearScale,
    LineElement,
    PointElement,
    Tooltip,
  } = await import("chart.js");
  ChartJsCore.register(
    LineElement,
    PointElement,
    CategoryScale,
    LinearScale,
    Filler,
    Legend,
    Tooltip,
  );
  registered = true;
}

export const AXIS_FONT = { family: "Geist Mono", size: 10 } as const;
export const LEGEND_FONT = { family: "Geist", size: 12 } as const;
