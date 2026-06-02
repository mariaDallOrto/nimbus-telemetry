import { useId } from "react";
import { NumberInput } from "./NumberInput";

type NumberFieldProps = {
  label: string;
  hint?: string;
  value: number;
  min?: number;
  max?: number;
  placeholder?: string;
  onValueChange: (next: number) => void;
};

/** Labeled numeric field — shares the .nb-field layout with the text Field. */
export function NumberField({
  label,
  hint,
  value,
  min,
  max,
  placeholder,
  onValueChange,
}: NumberFieldProps) {
  const id = useId();
  const hintId = hint ? `${id}-hint` : undefined;
  return (
    <div className="nb-field">
      <label className="nb-field__label" htmlFor={id}>
        {label}
      </label>
      <NumberInput
        id={id}
        className="nb-field__input"
        value={value}
        aria-describedby={hintId}
        onValueChange={onValueChange}
        {...(min !== undefined ? { min } : {})}
        {...(max !== undefined ? { max } : {})}
        {...(placeholder !== undefined ? { placeholder } : {})}
      />
      {hint ? (
        <span className="nb-field__hint" id={hintId}>
          {hint}
        </span>
      ) : null}
    </div>
  );
}
