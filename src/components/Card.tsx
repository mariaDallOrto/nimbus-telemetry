import type { ReactNode } from "react";

type CardProps = {
  heading?: string;
  action?: ReactNode;
  bodyPadding?: boolean;
  className?: string;
  children: ReactNode;
};

export function Card({ heading, action, bodyPadding = true, className, children }: CardProps) {
  return (
    <section className={`nb-card${className ? ` ${className}` : ""}`}>
      {heading || action ? (
        <header className="nb-card__header">
          {heading ? <h3 className="nb-card__heading">{heading}</h3> : <span />}
          {action}
        </header>
      ) : null}
      <div className={`nb-card__body${bodyPadding ? "" : " nb-card__body--flush"}`}>{children}</div>
    </section>
  );
}
