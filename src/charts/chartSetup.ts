// Type-only import: pulls in the plugin's module augmentation so
// `options.plugins.zoom` and `chart.resetZoom()` are typed without bundling
// the plugin eagerly (the runtime load stays lazy in ensureChartsRegistered).
import type {} from "chartjs-plugin-zoom";

let registered = false;

/** Register only the chart.js pieces the dashboard uses, once, lazily. */
export async function ensureChartsRegistered(): Promise<void> {
  if (registered) return;
  const [chartCore, zoom] = await Promise.all([import("chart.js"), import("chartjs-plugin-zoom")]);
  const {
    CategoryScale,
    Chart: ChartJsCore,
    Filler,
    Legend,
    LinearScale,
    LineElement,
    PointElement,
    Tooltip,
  } = chartCore;
  ChartJsCore.register(
    LineElement,
    PointElement,
    CategoryScale,
    LinearScale,
    Filler,
    Legend,
    Tooltip,
    zoom.default,
  );
  registered = true;
}

export const AXIS_FONT = { family: "Geist Mono", size: 10 } as const;
export const LEGEND_FONT = { family: "Geist", size: 12 } as const;
