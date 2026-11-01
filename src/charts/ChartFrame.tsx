import { useEffect, useRef, useState, type ReactNode } from "react";

type ChartFrameProps = {
  children: ReactNode;
  /** Controls above the plot; they stay with it in fullscreen. */
  header?: ReactNode;
  isZoomed: boolean;
  onResetZoom: () => void;
};

export function ChartFrame({ children, header, isZoomed, onResetZoom }: ChartFrameProps) {
  const figureRef = useRef<HTMLElement>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);

  useEffect(() => {
    const onChange = () => setIsFullscreen(document.fullscreenElement === figureRef.current);
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);

  const toggleFullscreen = () => {
    if (document.fullscreenElement) void document.exitFullscreen();
    else void figureRef.current?.requestFullscreen();
  };

  return (
    <figure ref={figureRef} className="nt-chart-frame">
      <div className="nt-chart-header">
        <div className="nt-chart-header__content">{header}</div>
        <div className="nt-chart-tools">
          <button
            type="button"
            className="nt-chart-tool"
            disabled={!isZoomed}
            onClick={onResetZoom}
            title="Voltar a ver tudo (ou duplo clique no gráfico)"
          >
            ⤢ Ver tudo
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
      </div>
      {children}
      <figcaption className="nt-chart-hint">
        Arraste para dar zoom · Ctrl + roda aproxima · Shift + roda anda · duplo clique volta
      </figcaption>
    </figure>
  );
}
