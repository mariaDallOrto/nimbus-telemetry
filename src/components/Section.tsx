import type { ReactNode } from "react";

type SectionProps = {
  title: string;
  eyebrow?: string;
  subtitle?: string;
  action?: ReactNode;
  children: ReactNode;
};

export function Section({ title, eyebrow, subtitle, action, children }: SectionProps) {
  return (
    <section className="nb-section">
      <header className="nb-section__header">
        <div className="nb-section__heading">
          {eyebrow ? <span className="nb-section__eyebrow">{eyebrow}</span> : null}
          <h2 className="nb-section__title">{title}</h2>
          {subtitle ? <p className="nb-section__subtitle">{subtitle}</p> : null}
        </div>
        {action}
      </header>
      {children}
    </section>
  );
}
