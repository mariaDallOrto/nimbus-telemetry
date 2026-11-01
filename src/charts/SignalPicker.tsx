import { useId, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { fuzzyScore } from "../ui/fuzzyScore";

type PickableSignal = { id: string; label: string; group: string; color: string; unit?: string };

type SignalPickerProps = {
  signals: readonly PickableSignal[];
  selectedIds: readonly string[];
  onToggle: (id: string) => void;
};

function bestScore(query: string, signal: PickableSignal): number | null {
  const scores = [signal.label, signal.group, signal.id]
    .map((text) => fuzzyScore(query, text))
    .filter((score) => score !== null);
  return scores.length > 0 ? Math.max(...scores) : null;
}

function matching<T extends PickableSignal>(signals: readonly T[], query: string): T[] {
  if (query.trim() === "") return [...signals];
  return signals
    .flatMap((signal) => {
      const score = bestScore(query, signal);
      return score === null ? [] : [{ signal, score }];
    })
    .sort((left, right) => right.score - left.score)
    .map(({ signal }) => signal);
}

/** Searchable multi-select: stays open so several signals can be toggled in a row. */
export function SignalPicker({ signals, selectedIds, onToggle }: SignalPickerProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const listRef = useRef<HTMLUListElement>(null);
  const baseId = useId();
  const listId = `${baseId}-list`;
  const optionId = (index: number) => `${baseId}-option-${index}`;

  const results = useMemo(() => matching(signals, query), [signals, query]);
  const activeSignal = results[activeIndex];

  const moveActive = (step: number) => {
    if (results.length === 0) return;
    const next = (activeIndex + step + results.length) % results.length;
    setActiveIndex(next);
    listRef.current?.children[next]?.scrollIntoView({ block: "nearest" });
  };

  const close = () => {
    setIsOpen(false);
    setQuery("");
    setActiveIndex(0);
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    const keyActions: Record<string, () => void> = {
      ArrowDown: () => (isOpen ? moveActive(1) : setIsOpen(true)),
      ArrowUp: () => (isOpen ? moveActive(-1) : setIsOpen(true)),
      Enter: () => {
        if (isOpen && activeSignal) onToggle(activeSignal.id);
      },
      Escape: close,
    };
    const action = keyActions[event.key];
    if (!action) return;
    event.preventDefault();
    action();
  };

  return (
    <div
      className="nt-picker"
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) close();
      }}
    >
      <input
        className="nt-picker__search"
        role="combobox"
        aria-label="Buscar sinal para colocar ou tirar do gráfico"
        aria-expanded={isOpen}
        aria-controls={listId}
        aria-autocomplete="list"
        {...(isOpen && activeSignal ? { "aria-activedescendant": optionId(activeIndex) } : {})}
        autoComplete="off"
        placeholder={`Buscar sinal · ${selectedIds.length} de ${signals.length} no gráfico`}
        value={query}
        onFocus={() => setIsOpen(true)}
        onClick={() => setIsOpen(true)}
        onChange={(event) => {
          setQuery(event.target.value);
          setActiveIndex(0);
          setIsOpen(true);
        }}
        onKeyDown={handleKeyDown}
      />
      {isOpen ? (
        <ul
          ref={listRef}
          id={listId}
          className="nt-picker__list"
          role="listbox"
          aria-multiselectable
          aria-label="Sinais"
          // Keeps focus in the search field, so the list survives each click.
          onMouseDown={(event) => event.preventDefault()}
        >
          {results.map((signal, index) => (
            <li
              key={signal.id}
              id={optionId(index)}
              className={`nt-picker__option${index === activeIndex ? " is-active" : ""}`}
              role="option"
              aria-selected={selectedIds.includes(signal.id)}
              onMouseEnter={() => setActiveIndex(index)}
              onClick={() => onToggle(signal.id)}
            >
              <span className="nt-picker__check" aria-hidden>
                {selectedIds.includes(signal.id) ? "✓" : ""}
              </span>
              <span
                className="nt-picker__swatch"
                aria-hidden
                style={{ background: signal.color }}
              />
              <span className="nt-picker__label">{signal.label}</span>
              <span className="nt-picker__group">{signal.group}</span>
            </li>
          ))}
          {results.length === 0 ? (
            <li className="nt-picker__none" role="presentation">
              Nenhum sinal com “{query}”
            </li>
          ) : null}
        </ul>
      ) : null}
    </div>
  );
}
