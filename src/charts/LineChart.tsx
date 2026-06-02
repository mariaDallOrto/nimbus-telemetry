import { Suspense, lazy, useCallback, useEffect, useRef, useState } from "react";
import type { Chart as ChartJS, ChartData, ChartOptions } from "chart.js";
import { ensureChartsRegistered } from "./chartSetup";

const Line = lazy(async () => {
  const [chartModule] = await Promise.all([import("react-chartjs-2"), ensureChartsRegistered()]);
  return { default: chartModule.Line };
});

type ZoomMode = "x" | "xy";

type LineChartProps = {
  data: ChartData<"line">;
  options: ChartOptions<"line">;
  ariaLabel: string;
  variant?: "default" | "mini";
  /** Enable drag-to-zoom (select a region) plus reset + fullscreen controls. */
  zoomable?: boolean;
  zoomMode?: ZoomMode;
};

/** Merge drag-zoom config into the caller's options without mutating them. */
function withZoom(options: ChartOptions<"line">, mode: ZoomMode): ChartOptions<"line"> {
  const basePadding =
    options.layout?.padding && typeof options.layout.padding === "object"
      ? options.layout.padding
      : {};
  return {
    ...options,
    // Reserve a top band so the legend renders below the floating tool buttons
    // instead of underneath them.
    layout: { ...options.layout, padding: { ...basePadding, top: 36 } },
    plugins: {
      ...options.plugins,
      zoom: {
        zoom: {
          drag: {
            enabled: true,
            backgroundColor: "rgba(255, 188, 0, 0.15)",
            borderColor: "#ffbc00",
            borderWidth: 1,
          },
          mode,
        },
      },
    },
  };
}

export function LineChart({
  data,
  options,
  ariaLabel,
  variant = "default",
  zoomable = false,
  zoomMode = "x",
}: LineChartProps) {
  const figureRef = useRef<HTMLElement>(null);
  const chartRef = useRef<ChartJS<"line", unknown, unknown> | null>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);

  useEffect(() => {
    const onChange = () => setIsFullscreen(document.fullscreenElement === figureRef.current);
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);

  const toggleFullscreen = useCallback(() => {
    const element = figureRef.current;
    if (!element) return;
    if (document.fullscreenElement) {
      void document.exitFullscreen();
    } else {
      void element.requestFullscreen();
    }
  }, []);

  const resetZoom = () => chartRef.current?.resetZoom();

  const finalOptions = zoomable ? withZoom(options, zoomMode) : options;

  return (
    <figure
      ref={figureRef}
      className={`nt-chart-frame${variant === "mini" ? " nt-chart-frame--mini" : ""}`}
      role="img"
      aria-label={ariaLabel}
    >
      {zoomable ? (
        <div className="nt-chart-tools">
          <button
            type="button"
            className="nt-chart-tool"
            onClick={resetZoom}
            title="Restaurar o zoom"
          >
            ⤢ Resetar
          </button>
          <button
            type="button"
            className="nt-chart-tool"
            onClick={toggleFullscreen}
            aria-pressed={isFullscreen}
          >
            {isFullscreen ? "✕ Sair" : "⛶ Tela cheia"}
          </button>
        </div>
      ) : null}
      <Suspense fallback={null}>
        <Line
          ref={(instance: ChartJS<"line", unknown, unknown> | null | undefined) => {
            chartRef.current = instance ?? null;
          }}
          data={data}
          options={finalOptions}
        />
      </Suspense>
    </figure>
  );
}
