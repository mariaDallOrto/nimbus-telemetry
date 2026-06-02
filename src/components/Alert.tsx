import type { ReactNode } from "react";

type AlertVariant = "info" | "success" | "warning" | "danger";

const ICONS: Record<AlertVariant, string> = {
  info: "ℹ",
  success: "✓",
  warning: "⚠",
  danger: "✕",
};

type AlertProps = {
  variant?: AlertVariant;
  children: ReactNode;
};

export function Alert({ variant = "info", children }: AlertProps) {
  return (
    <div
      className={`nb-alert nb-alert--${variant}`}
      role={variant === "danger" ? "alert" : "status"}
    >
      <span className="nb-alert__icon" aria-hidden>
        {ICONS[variant]}
      </span>
      <span>{children}</span>
    </div>
  );
}
