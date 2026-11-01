import { useState } from "react";
import { NumberInput } from "../components/NumberInput";

type AveragedSignal = { id: string; label: string; color: string };

type MovingAverageMenuProps = {
  signals: readonly AveragedSignal[];
  windowOf: (id: string) => number;
  onWindowChange: (id: string, window: number) => void;
};

const MAX_MOVING_AVERAGE = 500;

/** Keeps the smoothing settings out of the way until someone asks for them. */
export function MovingAverageMenu({ signals, windowOf, onWindowChange }: MovingAverageMenuProps) {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <div
      className="nt-average-menu"
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setIsOpen(false);
      }}
      onKeyDown={(event) => {
        if (event.key === "Escape") setIsOpen(false);
      }}
    >
      <button
        type="button"
        className="nt-chart-tool"
        aria-expanded={isOpen}
        disabled={signals.length === 0}
        onClick={() => setIsOpen(!isOpen)}
      >
        Média móvel
      </button>
      {isOpen ? (
        <div className="nt-average-menu__panel" role="group" aria-label="Média móvel" tabIndex={-1}>
          <p className="nt-average-menu__hint">Pontos usados na média. 1 desliga.</p>
          {signals.map((signal) => (
            <label key={signal.id} className="nt-average-menu__row">
              <span className="nt-signal__line" aria-hidden style={{ background: signal.color }} />
              <span>{signal.label}</span>
              <NumberInput
                value={windowOf(signal.id)}
                min={1}
                max={MAX_MOVING_AVERAGE}
                aria-label={`Média móvel de ${signal.label}, em pontos`}
                onValueChange={(next) => onWindowChange(signal.id, next)}
              />
            </label>
          ))}
        </div>
      ) : null}
    </div>
  );
}
