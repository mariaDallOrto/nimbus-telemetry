import type { CSSProperties, ReactNode } from "react";

type MetricTileProps = {
  label: string;
  value: string;
  unit?: string;
  /** Series color applied to the value text and the tile's top accent. */
  color?: string;
};

export function MetricTile({ label, value, unit, color }: MetricTileProps) {
  const hasData = value !== "—";
  const tileStyle: CSSProperties | undefined = color ? { borderTopColor: color } : undefined;
  const valueStyle: CSSProperties | undefined = color && hasData ? { color } : undefined;
  return (
    <div className="nb-metric" style={tileStyle}>
      <span className="nb-metric__label">{label}</span>
      <span className="nb-metric__value" style={valueStyle}>
        {value}
        {unit ? <span className="nb-metric__unit">{unit}</span> : null}
      </span>
    </div>
  );
}

export function MetricRow({ children }: { children: ReactNode }) {
  return <div className="nb-metric-row">{children}</div>;
}
