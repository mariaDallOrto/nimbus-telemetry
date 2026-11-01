import type uPlot from "uplot";

type XRange = { min: number; max: number };

const ZOOM_IN_FACTOR = 0.8;
const ZOOM_OUT_FACTOR = 1 / ZOOM_IN_FACTOR;
const PAN_FRACTION = 0.1;
const MIN_SPAN_RATIO = 0.002;

function clamped(range: XRange, limits: XRange): XRange {
  const span = Math.min(range.max - range.min, limits.max - limits.min);
  const min = Math.min(Math.max(range.min, limits.min), limits.max - span);
  return { min, max: min + span };
}

/** Scales the view around `pivot`, keeping the point under the mouse in place. */
export function zoomedRange(view: XRange, limits: XRange, pivot: number, factor: number): XRange {
  const fullSpan = limits.max - limits.min;
  const span = Math.max((view.max - view.min) * factor, fullSpan * MIN_SPAN_RATIO);
  const pivotRatio = (pivot - view.min) / (view.max - view.min);
  const min = pivot - span * pivotRatio;
  return clamped({ min, max: min + span }, limits);
}

export function pannedRange(view: XRange, limits: XRange, direction: number): XRange {
  const shift = (view.max - view.min) * PAN_FRACTION * direction;
  return clamped({ min: view.min + shift, max: view.max + shift }, limits);
}

function dataLimits(plot: uPlot): XRange | null {
  const xs = plot.data[0];
  const min = xs[0];
  const max = xs[xs.length - 1];
  return min === undefined || max === undefined || min === max ? null : { min, max };
}

/**
 * Ctrl/⌘ + wheel (or a trackpad pinch) zooms and Shift + wheel pans. A plain
 * wheel only zooms in fullscreen: on the page it has to keep scrolling.
 */
export function wheelZoomPlugin(): uPlot.Plugin {
  return {
    hooks: {
      ready: (plot) => {
        plot.over.addEventListener(
          "wheel",
          (event) => {
            const limits = dataLimits(plot);
            const { min, max } = plot.scales["x"] ?? {};
            if (!limits || min == null || max == null) return;
            const view = { min, max };
            if (event.shiftKey) {
              event.preventDefault();
              const delta = event.deltaX || event.deltaY;
              plot.setScale("x", pannedRange(view, limits, Math.sign(delta)));
              return;
            }
            const wantsZoom = event.ctrlKey || event.metaKey || document.fullscreenElement;
            if (!wantsZoom) return;
            event.preventDefault();
            const pivot = plot.posToVal(event.offsetX, "x");
            const factor = event.deltaY < 0 ? ZOOM_IN_FACTOR : ZOOM_OUT_FACTOR;
            plot.setScale("x", zoomedRange(view, limits, pivot, factor));
          },
          { passive: false },
        );
      },
    },
  };
}
