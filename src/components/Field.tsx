import { useId, type InputHTMLAttributes } from "react";

type FieldProps = {
  label: string;
  hint?: string;
  invalid?: boolean;
} & Omit<InputHTMLAttributes<HTMLInputElement>, "className" | "id">;

export function Field({ label, hint, invalid = false, ...inputProps }: FieldProps) {
  const id = useId();
  const hintId = hint ? `${id}-hint` : undefined;
  return (
    <div className={`nb-field${invalid ? " nb-field--invalid" : ""}`}>
      <label className="nb-field__label" htmlFor={id}>
        {label}
      </label>
      <input
        id={id}
        className="nb-field__input"
        aria-invalid={invalid}
        aria-describedby={hintId}
        {...inputProps}
      />
      {hint ? (
        <span className="nb-field__hint" id={hintId}>
          {hint}
        </span>
      ) : null}
    </div>
  );
}
