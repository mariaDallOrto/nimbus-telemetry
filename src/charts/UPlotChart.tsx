import { useEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import { createPortal } from "react-dom";
import uPlot from "uplot";
import "uplot/dist/uPlot.min.css";
import type { PlotOptions } from "./plotOptions";

type UPlotChartProps = {
  options: PlotOptions;
  data: uPlot.AlignedData;
  ariaLabel: string;
  plotRef?: RefObject<uPlot | null>;
  /** Drawn inside the plot area, so it can never cover the axes. */
  overlay?: ReactNode;
  /** New data always shows the whole range; otherwise a zoomed view survives data changes. */
  follow?: boolean;
  onCursorIndex?: (index: number | null) => void;
  onZoomChange?: (isZoomed: boolean) => void;
};

const X_EPSILON = 1e-6;

function isZoomed(plot: uPlot): boolean {
  const xs = plot.data[0];
  const first = xs[0];
  const last = xs[xs.length - 1];
  const { min, max } = plot.scales["x"] ?? {};
  if (first === undefined || last === undefined || min == null || max == null) return false;
  return min > first + X_EPSILON || max < last - X_EPSILON;
}

/** Owns one uPlot instance: options recreate it, data only feeds it through setData. */
export function UPlotChart({
  options,
  data,
  ariaLabel,
  plotRef,
  overlay,
  follow = false,
  onCursorIndex,
  onZoomChange,
}: UPlotChartProps) {
  const mountRef = useRef<HTMLDivElement>(null);
  const [plotArea, setPlotArea] = useState<HTMLElement | null>(null);
  const ownPlotRef = useRef<uPlot | null>(null);
  const zoomRef = useRef<{ min: number; max: number } | null>(null);
  const reportedZoomRef = useRef(false);
  const latestRef = useRef({ data, onCursorIndex, onZoomChange });
  latestRef.current = { data, onCursorIndex, onZoomChange };

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;
    const plot = new uPlot(
      {
        ...options,
        width: mount.clientWidth,
        height: mount.clientHeight,
        hooks: {
          ...options.hooks,
          setCursor: [(self) => latestRef.current.onCursorIndex?.(self.cursor.idx ?? null)],
          setScale: [
            (self, key) => {
              if (key !== "x") return;
              const zoomed = isZoomed(self);
              if (zoomed === reportedZoomRef.current) return;
              reportedZoomRef.current = zoomed;
              latestRef.current.onZoomChange?.(zoomed);
            },
          ],
        },
      },
      latestRef.current.data,
      mount,
    );
    if (zoomRef.current) plot.setScale("x", zoomRef.current);
    ownPlotRef.current = plot;
    if (plotRef) plotRef.current = plot;
    setPlotArea(plot.over);

    const resizeObserver = new ResizeObserver(([entry]) => {
      if (!entry) return;
      const { width, height } = entry.contentRect;
      plot.setSize({ width: Math.round(width), height: Math.round(height) });
    });
    resizeObserver.observe(mount);

    return () => {
      const { min, max } = plot.scales["x"] ?? {};
      zoomRef.current = isZoomed(plot) && min != null && max != null ? { min, max } : null;
      resizeObserver.disconnect();
      plot.destroy();
      setPlotArea(null);
      ownPlotRef.current = null;
      if (plotRef) plotRef.current = null;
    };
  }, [options, plotRef]);

  useEffect(() => {
    const plot = ownPlotRef.current;
    if (!plot || plot.data === data) return;
    const { min, max } = plot.scales["x"] ?? {};
    const xs = data[0];
    const keptMin = Math.max(min ?? Infinity, xs[0] ?? Infinity);
    const keptMax = Math.min(max ?? -Infinity, xs[xs.length - 1] ?? -Infinity);
    const keepsZoom = !follow && isZoomed(plot) && keptMin < keptMax;
    plot.batch(() => {
      plot.setData(data);
      if (keepsZoom) plot.setScale("x", { min: keptMin, max: keptMax });
    });
  }, [data, follow]);

  return (
    <>
      <div ref={mountRef} className="nt-plot" role="img" aria-label={ariaLabel} />
      {plotArea && overlay ? createPortal(overlay, plotArea) : null}
    </>
  );
}

export function resetZoom(plot: uPlot | null): void {
  const xs = plot?.data[0];
  const min = xs?.[0];
  const max = xs?.[xs.length - 1];
  if (plot && min !== undefined && max !== undefined) plot.setScale("x", { min, max });
}
