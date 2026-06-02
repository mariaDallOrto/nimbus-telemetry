import { useEffect, useRef, useState, type InputHTMLAttributes } from "react";

type NumberInputProps = {
  value: number;
  min?: number;
  max?: number;
  onValueChange: (next: number) => void;
} & Omit<
  InputHTMLAttributes<HTMLInputElement>,
  "value" | "onChange" | "type" | "inputMode" | "min" | "max"
>;

/**
 * Numeric input that keeps a free-text draft while focused so the field can be
 * emptied and retyped (you can clear the default "1" to type "50"). The parsed
 * value is committed live when valid and clamped on blur; an empty/invalid
 * field falls back to the last good value. Accepts comma or dot decimals.
 */
export function NumberInput({ value, min, max, onValueChange, ...rest }: NumberInputProps) {
  const [draft, setDraft] = useState(() => String(value));
  const editing = useRef(false);

  // Reflect external changes (e.g. a linked slider) only when not mid-edit.
  useEffect(() => {
    if (!editing.current) setDraft(String(value));
  }, [value]);

  function clamp(input: number): number {
    let next = input;
    if (min !== undefined) next = Math.max(min, next);
    if (max !== undefined) next = Math.min(max, next);
    return next;
  }

  return (
    <input
      {...rest}
      type="text"
      inputMode="decimal"
      value={draft}
      onFocus={() => {
        editing.current = true;
      }}
      onChange={(event) => {
        const raw = event.target.value;
        setDraft(raw);
        if (raw.trim() === "") return;
        const parsed = Number(raw.replace(",", "."));
        if (Number.isFinite(parsed)) onValueChange(clamp(parsed));
      }}
      onBlur={() => {
        editing.current = false;
        const parsed = Number(draft.replace(",", "."));
        const next = draft.trim() === "" || !Number.isFinite(parsed) ? value : clamp(parsed);
        onValueChange(next);
        setDraft(String(next));
      }}
    />
  );
}
