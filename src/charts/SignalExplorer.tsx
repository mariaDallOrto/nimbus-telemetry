import { useCallback, useMemo, useRef, useState, type ReactNode } from "react";
import type uPlot from "uplot";
import { movingAverage } from "../telemetry/movingAverage";
import { fixedOrDash, lastNumber, tail } from "../ui/format";
import { ChartFrame } from "./ChartFrame";
import { MovingAverageMenu } from "./MovingAverageMenu";
import { buildPlotOptions, type ChartSeries } from "./plotOptions";
import { SignalPicker } from "./SignalPicker";
import { resetZoom, UPlotChart } from "./UPlotChart";
import { anchorStyle, useDraggableAnchor } from "./useDraggableAnchor";
import { wheelZoomPlugin } from "./wheelZoom";

export type Signal = ChartSeries & {
  id: string;
  /** Heading the signal sits under in the picker. */
  group: string;
  digits: number;
};

type SignalDefault = { id: string; movingAverage: number };

/** Twelve 20px rows still fit the shortest plot; more signals start a second column. */
const MAX_TABLE_ROWS = 12;

/** Which signals are plotted and each one's moving-average window, in points. */
export function useSignalSelection(defaults: readonly SignalDefault[]) {
  const [selection, setSelection] = useState(() => selectionFrom(defaults));

  const windowOf = useCallback((id: string) => selection.windows[id] ?? 1, [selection.windows]);
  const toggle = useCallback((id: string) => {
    setSelection((previous) => ({
      ...previous,
      ids: previous.ids.includes(id)
        ? previous.ids.filter((selectedId) => selectedId !== id)
        : [...previous.ids, id],
    }));
  }, []);
  const setWindow = useCallback((id: string, window: number) => {
    setSelection((previous) => ({
      ...previous,
      windows: { ...previous.windows, [id]: Math.max(1, Math.floor(window)) },
    }));
  }, []);
  const reset = useCallback(
    (nextDefaults: readonly SignalDefault[]) => setSelection(selectionFrom(nextDefaults)),
    [],
  );

  return { ids: selection.ids, windowOf, toggle, setWindow, reset };
}

function selectionFrom(defaults: readonly SignalDefault[]) {
  return {
    ids: defaults.map((signal) => signal.id),
    windows: Object.fromEntries(defaults.map((signal) => [signal.id, signal.movingAverage])),
  };
}

type SignalExplorerProps = {
  x: readonly number[];
  signals: readonly Signal[];
  selection: ReturnType<typeof useSignalSelection>;
  defaults: readonly SignalDefault[];
  ariaLabel: string;
  formatX: (value: number) => string;
  xSteps: readonly number[];
  sharedScale?: boolean;
  /** Keep only the newest points after smoothing, so the average never restarts at the edge. */
  visiblePoints?: number;
  live?: boolean;
  follow?: boolean;
  onZoomChange?: (isZoomed: boolean) => void;
  /** Extra controls next to the signal picker. */
  controls?: ReactNode;
};

/** A chart plus the controls to choose, smooth and read each plotted signal. */
export function SignalExplorer({
  x,
  signals,
  selection,
  defaults,
  ariaLabel,
  formatX,
  xSteps,
  sharedScale = false,
  visiblePoints,
  live = false,
  follow = false,
  onZoomChange,
  controls,
}: SignalExplorerProps) {
  const plotRef = useRef<uPlot | null>(null);
  const tableAnchor = useDraggableAnchor();
  const [cursorIndex, setCursorIndex] = useState<number | null>(null);
  const [isZoomed, setIsZoomed] = useState(false);

  const handleZoomChange = useCallback(
    (zoomed: boolean) => {
      setIsZoomed(zoomed);
      onZoomChange?.(zoomed);
    },
    [onZoomChange],
  );

  const shown = useMemo(
    () => selection.ids.flatMap((id) => signals.filter((signal) => signal.id === id)),
    [selection.ids, signals],
  );
  // An empty selection unmounts the chart, which can no longer report its zoom.
  if (shown.length === 0 && isZoomed) setIsZoomed(false);
  const shownSignature = shown.map((signal) => signal.id).join("|");
  const shownRef = useRef(shown);
  shownRef.current = shown;

  // Rebuilding destroys the chart, so it happens only when the axes or series
  // change; new samples reach it through setData.
  const options = useMemo(
    () =>
      buildPlotOptions({
        series: shownRef.current,
        xAxis: { format: formatX, steps: xSteps },
        sharedScale,
        live,
        plugins: [wheelZoomPlugin()],
      }),
    [shownSignature, formatX, xSteps, sharedScale, live],
  );

  const smoothed = useMemo(
    () =>
      shown.map((signal) => {
        const values = movingAverage(signal.data, selection.windowOf(signal.id));
        return visiblePoints === undefined ? values : tail(values, visiblePoints);
      }),
    [shown, selection.windowOf, visiblePoints],
  );
  const data = useMemo<uPlot.AlignedData>(
    () => [visiblePoints === undefined ? [...x] : tail(x, visiblePoints), ...smoothed],
    [x, smoothed, visiblePoints],
  );

  const hoveredX = cursorIndex === null ? undefined : data[0][cursorIndex];

  const header = (
    <>
      <SignalPicker
        signals={signals}
        selectedIds={shown.map((signal) => signal.id)}
        onToggle={selection.toggle}
      />
      <MovingAverageMenu
        signals={shown}
        windowOf={selection.windowOf}
        onWindowChange={selection.setWindow}
      />
      <button
        type="button"
        className="nt-chart-tool"
        onClick={() => {
          selection.reset(defaults);
          tableAnchor.reset();
        }}
      >
        Voltar ao padrão
      </button>
      {controls}
      <output className="nt-chart-readout">
        {hoveredX === undefined ? (live ? "Último valor" : "Fim do log") : formatX(hoveredX)}
      </output>
    </>
  );

  const tableRows = { gridTemplateRows: `repeat(${Math.min(shown.length, MAX_TABLE_ROWS)}, auto)` };
  const tableEntries = shown.map((signal, index) => {
    const values = smoothed[index] ?? [];
    const value = cursorIndex === null ? lastNumber(values) : (values[cursorIndex] ?? null);
    return (
      <li key={signal.id} className="nt-signal">
        <span className="nt-signal__line" aria-hidden style={{ background: signal.color }} />
        <span className="nt-signal__name">{signal.label}</span>
        <output className="nt-signal__value">
          {fixedOrDash(value, signal.digits)}
          {signal.unit ? <small>{signal.unit}</small> : null}
        </output>
      </li>
    );
  });
  const floatingTable = (
    <ul
      className="nt-signals nt-signals--floating"
      aria-label="Sinais no gráfico. Arraste ou use as setas para mover"
      tabIndex={0}
      style={{ ...tableRows, ...anchorStyle(tableAnchor.anchor) }}
      {...tableAnchor.handlers}
    >
      {tableEntries}
    </ul>
  );
  const stackedTable = (
    <ul className="nt-signals nt-signals--stacked" aria-label="Sinais no gráfico" style={tableRows}>
      {tableEntries}
    </ul>
  );

  return (
    <ChartFrame header={header} isZoomed={isZoomed} onResetZoom={() => resetZoom(plotRef.current)}>
      {shown.length > 0 ? stackedTable : null}
      {shown.length > 0 ? (
        <UPlotChart
          options={options}
          data={data}
          ariaLabel={ariaLabel}
          plotRef={plotRef}
          overlay={floatingTable}
          follow={follow}
          onCursorIndex={setCursorIndex}
          onZoomChange={handleZoomChange}
        />
      ) : (
        <div className="nt-empty">
          <span className="nt-empty__title">Nenhum sinal no gráfico</span>
          <span className="nt-empty__hint">
            Busque um sinal no campo acima para montar o gráfico.
          </span>
        </div>
      )}
    </ChartFrame>
  );
}
