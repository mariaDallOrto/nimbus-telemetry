import type { ButtonHTMLAttributes, ReactNode } from "react";

type ButtonVariant = "primary" | "secondary" | "ghost" | "success" | "danger";

type ButtonProps = {
  variant?: ButtonVariant;
  block?: boolean;
  children: ReactNode;
  className?: string;
} & Omit<ButtonHTMLAttributes<HTMLButtonElement>, "className">;

export function Button({
  variant = "secondary",
  block = false,
  children,
  className,
  type = "button",
  ...rest
}: ButtonProps) {
  const classes = `nb-btn nb-btn--${variant}${block ? " nb-btn--block" : ""}${className ? ` ${className}` : ""}`;
  return (
    <button type={type} className={classes} {...rest}>
      {children}
    </button>
  );
}
