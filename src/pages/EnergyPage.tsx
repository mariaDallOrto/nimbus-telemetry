import { useEffect, useId, useMemo, useState, type CSSProperties } from "react";
import { Alert } from "../components/Alert";
import { Card } from "../components/Card";
import { MetricRow, MetricTile } from "../components/MetricTile";
import { NumberField } from "../components/NumberField";
import { Section } from "../components/Section";
import { SeriesChart, type ChartSeries } from "../charts/SeriesChart";
import {
  CHART_COLOR_CLAMP,
  CHART_COLOR_CURRENT,
  CHART_COLOR_ENERGY,
  CHART_COLOR_RPM,
  CHART_COLOR_STICK,
  CHART_COLOR_TEXT_SOFT,
  CHART_COLOR_VOLTAGE,
  CHART_SERIES_PALETTE,
} from "../charts/chartColors";
import { BudgetMath, PointMath, fmt } from "./EnergyMath";
import { numericColumn, parseCsv, temporalLabels, type ParsedCsv } from "../telemetry/csv";
import {
  HAI_WEAPON,
  consumedMah,
  fightBudget,
  logDurationSeconds,
  sheetRpm,
  stickPoints,
  weaponCurve,
  weaponEnergy,
  type CurrentSource,
  type StickPoint,
  type WeaponParams,
} from "../telemetry/energy";

const CURRENT_HEADER = "Corrente_Med_A";
const CLAMP_HEADER = "Alicate_A";
const CHART_BRAND = CHART_SERIES_PALETTE[0];
const TEST_COLORS = [CHART_COLOR_STICK, CHART_BRAND] as const;

type TestLog = { id: string; file: string; name: string; description: string };

const TESTS: readonly TestLog[] = [
  {
    id: "t1",
    file: "2026-10-24/14h23.csv",
    name: "Teste 1 · 14h23",
    description: "Bateria já usada, saiu de 15,5 V (3,87 V/célula).",
  },
  {
    id: "t2",
    file: "2026-10-24/14h38.csv",
    name: "Teste 2 · 14h38",
    description: "Bateria cheia, saiu de 16,7 V (4,18 V/célula). É o estado de começo de luta.",
  },
];

const PLAN_LEVELS = [100, 80, 60, 40] as const;

type LoadedTest = TestLog & { parsed: ParsedCsv };

type SegmentedProps<T extends string> = {
  label: string;
  value: T;
  options: readonly { value: T; label: string }[];
  onChange: (next: T) => void;
};

function Segmented<T extends string>({ label, value, options, onChange }: SegmentedProps<T>) {
  return (
    <div className="nt-segmented" role="group" aria-label={label}>
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          className={`nt-segmented__option${option.value === value ? " is-active" : ""}`}
          aria-pressed={option.value === value}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

type TimeSeriesKey =
  | "voltage"
  | "stick"
  | "current"
  | "clamp"
  | "limit"
  | "rpmSheet"
  | "joules"
  | "meters";

const TIME_SERIES: readonly { key: TimeSeriesKey; label: string }[] = [
  { key: "stick", label: "Stick" },
  { key: "current", label: "Corrente telemetria" },
  { key: "clamp", label: "Alicate" },
  { key: "limit", label: "Média que cabe na luta" },
  { key: "voltage", label: "Tensão" },
  { key: "rpmSheet", label: "RPM" },
  { key: "joules", label: "Energia" },
  { key: "meters", label: "Energia em altura" },
];

type PresetId = "overview" | "limit" | "sag" | "energy" | "all";

type Preset = {
  id: PresetId;
  label: string;
  keys: readonly TimeSeriesKey[];
  hint: (limitAmps: number) => string;
};

const PRESETS: readonly Preset[] = [
  {
    id: "overview",
    label: "Visão geral",
    keys: ["stick", "current", "clamp", "voltage"],
    hint: () =>
      "Stick, corrente e tensão no mesmo tempo, como no relatório da bancada. Cada degrau de stick puxa mais corrente e derruba a tensão.",
  },
  {
    id: "limit",
    label: "Corrente vs média da luta",
    keys: ["stick", "current", "clamp", "limit"],
    hint: (limitAmps) =>
      `A linha pontilhada é a corrente média que cabe na luta com o plano atual (${fmt(limitAmps, 1)} A). Passar dela por um tempo é normal, desde que o resto da luta fique abaixo.`,
  },
  {
    id: "sag",
    label: "Queda de tensão",
    keys: ["voltage", "current"],
    hint: () =>
      "Quanto a bateria cede quando a arma puxa corrente. Tensão menor sob carga quer dizer RPM menor.",
  },
  {
    id: "energy",
    label: "Energia na arma",
    keys: ["stick", "joules", "rpmSheet"],
    hint: () =>
      "Energia guardada na arma a cada instante, pela RPM da planilha. Ela cresce com o quadrado da RPM, então os degraus altos de stick pesam muito mais.",
  },
  {
    id: "all",
    label: "Tudo junto",
    keys: TIME_SERIES.map((s) => s.key),
    hint: () => "Todas as séries ligadas. Desligue as que atrapalham nos botões abaixo.",
  },
];

const DEFAULT_PRESET = PRESETS[0] as Preset;

function timeSeries(
  parsed: ParsedCsv,
  params: WeaponParams,
  limitAmps: number,
): Record<TimeSeriesKey, ChartSeries> {
  const voltage = numericColumn(parsed.rows, "TensaoTotal_V");
  const stick = numericColumn(parsed.rows, "Comando_Pct");
  const current = numericColumn(parsed.rows, CURRENT_HEADER);
  const rpmSheet = stick.map((s) => (s == null ? null : sheetRpm(s, params)));
  const energy = (rpm: readonly (number | null)[], unit: "joules" | "meters") =>
    rpm.map((r) => (r == null ? null : weaponEnergy(r, params)[unit]));
  return {
    voltage: {
      label: "Tensão (V)",
      data: voltage,
      color: CHART_COLOR_VOLTAGE,
      scaleGroup: "voltage",
      unit: "V",
    },
    stick: {
      label: "Stick (%)",
      data: stick,
      color: CHART_COLOR_STICK,
      scaleGroup: "stick",
      unit: "%",
      range: [0, 100],
    },
    current: {
      label: "Corrente telemetria (A)",
      data: current,
      color: CHART_COLOR_CURRENT,
      scaleGroup: "current",
      unit: "A",
    },
    clamp: {
      label: "Alicate (A)",
      data: numericColumn(parsed.rows, CLAMP_HEADER),
      color: CHART_COLOR_CLAMP,
      markers: true,
      scaleGroup: "current",
      unit: "A",
    },
    limit: {
      label: "Média que cabe na luta (A)",
      data: parsed.rows.map(() => limitAmps),
      color: CHART_COLOR_TEXT_SOFT,
      reference: true,
      scaleGroup: "current",
      unit: "A",
    },
    rpmSheet: {
      label: "RPM",
      data: rpmSheet,
      color: CHART_COLOR_RPM,
      scaleGroup: "rpm",
      unit: "rpm",
      min: 0,
    },
    joules: {
      label: "Energia (J)",
      data: energy(rpmSheet, "joules"),
      color: CHART_COLOR_ENERGY,
      scaleGroup: "joules",
      unit: "J",
      min: 0,
    },
    meters: {
      label: "Energia em altura (m)",
      data: energy(rpmSheet, "meters"),
      color: CHART_BRAND,
      scaleGroup: "meters",
      unit: "m",
      min: 0,
    },
  };
}

function elapsedLabels(rows: ParsedCsv["rows"]): string[] {
  const seconds = temporalLabels(rows).map((label) => {
    const [h = 0, m = 0, s = 0] = label.split(":").map(Number);
    return h * 3600 + m * 60 + s;
  });
  const start = seconds[0] ?? 0;
  return seconds.map((t) => {
    const elapsed = Math.max(0, Math.round(t - start));
    return `${Math.floor(elapsed / 60)}:${String(elapsed % 60).padStart(2, "0")}`;
  });
}

function PointsTable({ points }: { points: readonly StickPoint[] }) {
  const top = points.reduce<StickPoint | null>(
    (best, p) => (best === null || p.stickHeld > best.stickHeld ? p : best),
    null,
  );
  return (
    <div className="nb-table-scroll">
      <table className="nb-table nt-points">
        <thead>
          <tr>
            <th>Stick</th>
            <th title="Mediana do stick em ±1 s da leitura">Mantido</th>
            <th>Tensão</th>
            <th>I telem.</th>
            <th>I alicate</th>
            <th>RPM</th>
            <th>Energia</th>
            <th>Altura</th>
            <th title="Energia em relação ao ponto de 100 %">E vs 100 %</th>
            <th title="Corrente do alicate em relação ao ponto de 100 %">I vs 100 %</th>
          </tr>
          <tr className="nt-points__units">
            <th>%</th>
            <th>%</th>
            <th>V</th>
            <th>A</th>
            <th>A</th>
            <th>rpm</th>
            <th>J</th>
            <th>m</th>
            <th>%</th>
            <th>%</th>
          </tr>
        </thead>
        <tbody>
          {points.map((p) => (
            <tr key={p.row}>
              <td>{fmt(p.stickSet)}</td>
              <td>{fmt(p.stickHeld)}</td>
              <td>{fmt(p.voltage, 2)}</td>
              <td>{fmt(p.current, 1)}</td>
              <td>{fmt(p.clamp, 1)}</td>
              <td>{fmt(p.rpmSheet)}</td>
              <td className="nt-points__energy">{fmt(p.energySheet.joules)}</td>
              <td>{fmt(p.energySheet.meters, 1)}</td>
              <td>{top ? fmt((100 * p.energySheet.joules) / top.energySheet.joules) : "—"}</td>
              <td>{top ? fmt((100 * p.clamp) / top.clamp) : "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function TestExplorer({
  tests,
  params,
  limitAmps,
}: {
  tests: readonly LoadedTest[];
  params: WeaponParams;
  limitAmps: number;
}) {
  const [testId, setTestId] = useState<string>(tests[tests.length - 1]?.id ?? "");
  const [presetId, setPresetId] = useState<PresetId | "custom">(DEFAULT_PRESET.id);
  const [enabled, setEnabled] = useState<ReadonlySet<TimeSeriesKey>>(
    () => new Set(DEFAULT_PRESET.keys),
  );
  const presetSelectId = useId();
  const test = tests.find((t) => t.id === testId) ?? tests[0];
  const labels = useMemo(() => (test ? elapsedLabels(test.parsed.rows) : []), [test]);
  const series = useMemo(
    () => (test ? timeSeries(test.parsed, params, limitAmps) : null),
    [test, params, limitAmps],
  );
  const points = useMemo(
    () => (test ? stickPoints(test.parsed.rows, CURRENT_HEADER, CLAMP_HEADER, params) : []),
    [test, params],
  );
  if (!test || !series) return null;

  const rows = test.parsed.rows;
  const duration = logDurationSeconds(rows);
  const used = consumedMah(rows, CURRENT_HEADER);
  const vStart = numericColumn(rows.slice(0, 1), "TensaoTotal_V")[0] ?? 0;
  const vEnd = numericColumn(rows.slice(-1), "TensaoTotal_V")[0] ?? 0;
  const shown = TIME_SERIES.filter((s) => enabled.has(s.key)).map((s) => series[s.key]);
  const preset = PRESETS.find((p) => p.id === presetId);
  const short = (name: string) => name.split(" · ")[0] ?? name;

  const choosePreset = (id: string) => {
    const next = PRESETS.find((p) => p.id === id);
    if (!next) return;
    setPresetId(next.id);
    setEnabled(new Set(next.keys));
  };

  const toggle = (key: TimeSeriesKey) => {
    const next = new Set(enabled);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    setEnabled(next);
    const match = PRESETS.find(
      (p) => p.keys.length === next.size && p.keys.every((k) => next.has(k)),
    );
    setPresetId(match ? match.id : "custom");
  };

  return (
    <Section
      title="Explorar os testes"
      eyebrow="Bancada · 24/10"
      subtitle={test.description}
      action={
        <Segmented
          label="Teste mostrado"
          value={test.id}
          options={tests.map((t) => ({ value: t.id, label: short(t.name) }))}
          onChange={setTestId}
        />
      }
    >
      <MetricRow>
        <MetricTile label="Duração" value={fmt(duration)} unit="s" />
        <MetricTile
          label="Consumo da arma"
          value={fmt(used)}
          unit="mAh"
          color={CHART_COLOR_CURRENT}
        />
        <MetricTile
          label="Tensão início → fim"
          value={`${fmt(vStart, 2)} → ${fmt(vEnd, 2)}`}
          unit="V"
          color={CHART_COLOR_VOLTAGE}
        />
        <MetricTile
          label="Energia máx."
          value={fmt(Math.max(0, ...points.map((p) => p.energySheet.joules)))}
          unit="J"
          color={CHART_COLOR_ENERGY}
        />
      </MetricRow>

      <Card bodyPadding={false}>
        <div className="nt-explorer">
          <div className="nt-explorer__bar">
            <div className="nb-field nt-explorer__view">
              <label className="nb-field__label" htmlFor={presetSelectId}>
                O que ver
              </label>
              <select
                id={presetSelectId}
                className="nb-field__input"
                value={presetId}
                onChange={(event) => choosePreset(event.target.value)}
              >
                {PRESETS.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.label}
                  </option>
                ))}
                {presetId === "custom" ? <option value="custom">Personalizado</option> : null}
              </select>
            </div>
            <p className="nt-explorer__hint" aria-live="polite">
              {preset
                ? preset.hint(limitAmps)
                : "Seleção feita à mão. Escolha uma visão na lista para voltar a um recorte pronto."}
            </p>
          </div>

          <div
            className="nt-toggle-grid nt-explorer__series"
            role="group"
            aria-label="Séries no gráfico"
          >
            {TIME_SERIES.map((s) => {
              const on = enabled.has(s.key);
              const entry = series[s.key];
              const style = entry.reference ? "dotted" : entry.dashed ? "dashed" : "solid";
              return (
                <button
                  key={s.key}
                  type="button"
                  className={`nt-toggle nt-explorer__toggle${on ? " is-on" : ""}`}
                  aria-pressed={on}
                  onClick={() => toggle(s.key)}
                >
                  <span
                    className={`nt-explorer__swatch nt-explorer__swatch--${entry.markers ? "marker" : style}`}
                    aria-hidden
                    style={{ color: on ? entry.color : undefined }}
                  />
                  {s.label}
                  {entry.unit && !s.label.includes("(") ? (
                    <span className="nt-explorer__unit">{entry.unit}</span>
                  ) : null}
                </button>
              );
            })}
          </div>

          {shown.length > 0 ? (
            <SeriesChart
              labels={labels}
              series={shown}
              ariaLabel={`${test.name}: ${shown.map((entry) => entry.label).join(", ")} no tempo`}
              independentScales
              showScales
              legend={false}
            />
          ) : (
            <div className="nt-explorer__empty">
              Nenhuma série ligada. Escolha uma visão na lista ou ligue uma série acima.
            </div>
          )}

          <p className="nt-explorer__foot">
            Tempo em minutos desde o início do log. Cada unidade tem seu eixo, na cor da série. RPM
            e energia saem da conta da planilha. Bolinha é leitura do alicate. Arraste no gráfico
            para dar zoom num trecho.
          </p>
        </div>
      </Card>

      <Card heading={`Pontos medidos com o alicate · ${short(test.name)}`} bodyPadding={false}>
        <PointsTable points={points} />
      </Card>
    </Section>
  );
}

const STICK_AXIS = Array.from({ length: 101 }, (_, pct) => pct);

/** Measured points of each test placed on a 0–100 % stick axis by the stick actually held. */
function curveSeries(
  tests: readonly { test: LoadedTest; points: readonly StickPoint[] }[],
  pick: (p: StickPoint) => readonly number[],
  names: readonly string[],
): ChartSeries[] {
  return tests.flatMap(({ test, points }, index) => {
    const color = TEST_COLORS[index % TEST_COLORS.length] ?? CHART_COLOR_ENERGY;
    const short = test.name.split(" · ")[0] ?? test.name;
    return names.map((name, which) => {
      const data: (number | null)[] = STICK_AXIS.map(() => null);
      for (const point of points) {
        const at = Math.round(Math.min(100, Math.max(0, point.stickHeld)));
        data[at] = pick(point)[which] ?? null;
      }
      return { label: `${short} · ${name}`, data, color, markers: true, dashed: which > 0 };
    });
  });
}

function pointAt(stickPct: number, value: number): (number | null)[] {
  const at = Math.round(Math.min(100, Math.max(0, stickPct)));
  return STICK_AXIS.map((pct) => (pct === at ? value : null));
}

type PlanState = {
  capacityMah: number;
  usablePct: number;
  durationSeconds: number;
  driveCurrent: number;
  seconds: Record<(typeof PLAN_LEVELS)[number], number>;
  spinUps: number;
  spinUpEfficiencyPct: number;
};

const DEFAULT_PLAN: PlanState = {
  capacityMah: 930,
  usablePct: 80,
  durationSeconds: 180,
  driveCurrent: 7,
  seconds: { 100: 20, 80: 20, 60: 30, 40: 0 },
  spinUps: 8,
  spinUpEfficiencyPct: 60,
};

function BudgetBar({
  capacity,
  usable,
  parts,
}: {
  capacity: number;
  usable: number;
  parts: readonly { label: string; mah: number; color: string }[];
}) {
  const total = parts.reduce((sum, p) => sum + p.mah, 0);
  const scale = Math.max(capacity, total);
  const pct = (mah: number) => `${(100 * Math.max(0, mah)) / scale}%`;
  return (
    <div className="nt-budget">
      <div className="nt-budget__track" role="img" aria-label="Uso da bateria no plano">
        {parts.map((p) => (
          <span
            key={p.label}
            className="nt-budget__part"
            style={{ width: pct(p.mah), background: p.color } as CSSProperties}
            title={`${p.label}: ${fmt(p.mah)} mAh`}
          />
        ))}
        <span className="nt-budget__limit" style={{ left: pct(usable) }} aria-hidden />
        <span
          className="nt-budget__limit nt-budget__limit--full"
          style={{ left: pct(capacity) }}
          aria-hidden
        />
      </div>
      <div className="nt-budget__legend">
        {parts.map((p) => (
          <span key={p.label} className="nt-budget__key">
            <span className="nt-budget__swatch" style={{ background: p.color }} aria-hidden />
            {p.label} <strong>{fmt(p.mah)} mAh</strong>
          </span>
        ))}
        <span className="nt-budget__key">
          <span className="nt-budget__swatch nt-budget__swatch--limit" aria-hidden />
          Limite de uso <strong>{fmt(usable)} mAh</strong>
        </span>
      </div>
    </div>
  );
}

export default function EnergyPage() {
  const [tests, setTests] = useState<LoadedTest[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [params, setParams] = useState<WeaponParams>(HAI_WEAPON);
  const [plan, setPlan] = useState<PlanState>(DEFAULT_PLAN);
  const [baseTest, setBaseTest] = useState<string>("t2");
  const [source, setSource] = useState<CurrentSource>("clamp");

  useEffect(() => {
    const controller = new AbortController();
    Promise.all(
      TESTS.map((test) =>
        fetch(`${import.meta.env.BASE_URL}examples/${test.file}`, { signal: controller.signal })
          .then((response) => {
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            return response.text();
          })
          .then((text) => ({ ...test, parsed: parseCsv(text) })),
      ),
    )
      .then(setTests)
      .catch((caught) => {
        if (controller.signal.aborted) return;
        setError("Não foi possível carregar os logs dos testes.");
        console.error("energy logs fetch failed", caught);
      });
    return () => controller.abort();
  }, []);

  const measured = useMemo(
    () =>
      (tests ?? []).map((test) => ({
        test,
        points: stickPoints(test.parsed.rows, CURRENT_HEADER, CLAMP_HEADER, params),
      })),
    [tests, params],
  );

  const base = measured.find((m) => m.test.id === baseTest) ?? measured[0];
  const curve = useMemo(() => (base ? weaponCurve(base.points, source) : null), [base, source]);
  const shares = useMemo(
    () => PLAN_LEVELS.map((level) => ({ stickPct: level, seconds: plan.seconds[level] })),
    [plan.seconds],
  );
  const budget = useMemo(() => {
    if (!curve) return null;
    return fightBudget(
      {
        capacityMah: plan.capacityMah,
        usableFraction: plan.usablePct / 100,
        durationSeconds: plan.durationSeconds,
        driveCurrent: plan.driveCurrent,
        shares,
        spinUps: plan.spinUps,
        spinUpStickPct: 100,
        spinUpEfficiency: plan.spinUpEfficiencyPct / 100,
      },
      curve,
    );
  }, [curve, plan, shares]);

  const curveName = base
    ? `${base.test.name.split(" · ")[0] ?? base.test.name} ${source === "clamp" ? "pelo alicate" : "pela telemetria"}`
    : "";
  const energyCurves = useMemo<ChartSeries[]>(() => {
    const curves = curveSeries(measured, (p) => [p.energySheet.joules], ["energia (J)"]);
    if (!budget) return curves;
    return [
      ...curves,
      {
        label: `Stick que cabe na luta (${fmt(budget.continuousStickPct)} %)`,
        data: pointAt(budget.continuousStickPct, budget.continuousJoules),
        color: CHART_COLOR_CLAMP,
        highlight: true,
      },
    ];
  }, [measured, budget]);
  const currentCurves = useMemo<ChartSeries[]>(() => {
    const curves = curveSeries(measured, (p) => [p.clamp], ["alicate (A)"]);
    if (!budget) return curves;
    return [
      ...curves,
      {
        label: `Média que cabe na luta (${fmt(budget.weaponAverageLimit, 1)} A)`,
        data: STICK_AXIS.map(() => budget.weaponAverageLimit),
        color: CHART_COLOR_TEXT_SOFT,
        reference: true,
      },
      {
        label: `Stick que cabe na luta (${fmt(budget.continuousStickPct)} %)`,
        data: pointAt(budget.continuousStickPct, budget.weaponAverageLimit),
        color: CHART_COLOR_CLAMP,
        highlight: true,
      },
    ];
  }, [measured, budget]);

  const setSeconds = (level: (typeof PLAN_LEVELS)[number], value: number) =>
    setPlan((prev) => ({ ...prev, seconds: { ...prev.seconds, [level]: value } }));
  const planned = PLAN_LEVELS.reduce((sum, level) => sum + plan.seconds[level], 0);
  const usableMah = plan.capacityMah * (plan.usablePct / 100);
  const fits = budget ? budget.marginMah >= 0 : true;

  return (
    <main className="nb-main nt-energy">
      <div className="nb-content">
        <header className="nb-hero">
          <div>
            <div className="nb-hero__eyebrow">
              <span className="nb-hero__eyebrow-dot" aria-hidden />
              <span>Hai · arma · Brasília + TI</span>
            </div>
            <h1 className="nb-hero__title">Energia da arma</h1>
            <p className="nb-hero__lede">
              Quanto cada % de stick entrega de energia na porrada e quanto isso custa da bateria
              (GNB 4S 930 mAh) numa luta de 3 minutos.
            </p>
          </div>
        </header>

        {error ? <Alert variant="danger">{error}</Alert> : null}
        {!tests && !error ? (
          <p className="nb-section__subtitle" aria-busy="true">
            Carregando os testes…
          </p>
        ) : null}

        {budget && curve && base ? (
          <>
            <Section
              title="Quanto a arma pode puxar"
              eyebrow="Resumo da luta"
              subtitle={`Bateria de ${fmt(plan.capacityMah)} mAh usando ${fmt(plan.usablePct)} %, ${fmt(plan.durationSeconds)} s de luta, locomoção a ${fmt(plan.driveCurrent, 1)} A e ${fmt(plan.spinUps)} reacelerações de 0 a 100 %.`}
            >
              <MetricRow>
                <MetricTile
                  label="Corrente média da arma"
                  value={fmt(budget.weaponAverageLimit, 1)}
                  unit="A"
                  color={CHART_COLOR_CURRENT}
                />
                <MetricTile
                  label="Stick contínuo equivalente"
                  value={fmt(budget.continuousStickPct)}
                  unit="%"
                  color={CHART_COLOR_STICK}
                />
                <MetricTile
                  label="Energia nesse stick"
                  value={fmt(budget.continuousJoules)}
                  unit="J"
                  color={CHART_COLOR_ENERGY}
                />
                <MetricTile
                  label="Tempo em 100 % (resto em 0)"
                  value={fmt(budget.fullThrottleSeconds)}
                  unit="s"
                  color={CHART_COLOR_RPM}
                />
                <MetricTile
                  label="Custo de cada reaceleração"
                  value={fmt(budget.spinUpMahEach, 1)}
                  unit="mAh"
                />
              </MetricRow>
              <p className="nt-energy-note">
                A média é o que sobra do limite de uso depois da locomoção e das reacelerações,
                dividido pela luta. Segurar o stick fixo nesse valor gasta exatamente o limite;
                variar entre 100 % e 0 % também serve, desde que a média feche. Cada número, com a
                conta feita, está em “Como cada conta foi feita”.
              </p>
            </Section>

            <Section
              title="Energia e corrente por % de stick"
              eyebrow="Os dois testes"
              subtitle={`O losango marca o stick que dá para segurar a luta inteira (${fmt(budget.continuousStickPct)} %, curva do ${curveName}): ali a corrente bate na média que cabe na bateria e a arma guarda ${fmt(budget.continuousJoules)} J. A energia cresce com o quadrado da RPM, então baixar o stick derruba a porrada mais rápido do que a corrente.`}
            >
              <div className="nt-energy-curves">
                <Card heading="Corrente da arma (A)" bodyPadding={false}>
                  <div style={{ padding: 18 }}>
                    <SeriesChart
                      labels={STICK_AXIS.map((pct) => `${pct} %`)}
                      series={currentCurves}
                      xTickEvery={10}
                      xTitle="stick segurado (%)"
                      ariaLabel="Corrente da arma por porcentagem de stick nos dois testes, com a média que cabe na luta"
                    />
                  </div>
                </Card>
                <Card heading="Energia armazenada (J)" bodyPadding={false}>
                  <div style={{ padding: 18 }}>
                    <SeriesChart
                      labels={STICK_AXIS.map((pct) => `${pct} %`)}
                      series={energyCurves}
                      xTickEvery={10}
                      xTitle="stick segurado (%)"
                      ariaLabel="Energia da arma por porcentagem de stick nos dois testes, pela RPM da planilha"
                    />
                  </div>
                </Card>
              </div>
              <p className="nt-energy-note">
                Cada bolinha é uma leitura do alicate, no stick que estava realmente segurado. A
                energia sai da RPM da planilha. A linha pontilhada e o losango mudam junto com o
                plano de luta.
              </p>
            </Section>

            <Section
              title="Plano de luta"
              eyebrow="Simulação"
              subtitle="Distribua os segundos da luta entre os níveis de stick. O que não for distribuído conta como arma em 0 %."
              action={
                <div className="nt-energy-controls">
                  <Segmented
                    label="Teste usado como curva"
                    value={baseTest}
                    options={measured.map((m) => ({
                      value: m.test.id,
                      label: m.test.name.split(" · ")[0] ?? m.test.name,
                    }))}
                    onChange={setBaseTest}
                  />
                  <Segmented
                    label="Fonte da corrente"
                    value={source}
                    options={[
                      { value: "clamp", label: "Alicate" },
                      { value: "telemetry", label: "Telemetria" },
                    ]}
                    onChange={setSource}
                  />
                </div>
              }
            >
              <div className="nt-energy-plan">
                <Card heading="Bateria e luta">
                  <div className="nt-params">
                    <NumberField
                      label="Capacidade"
                      hint="mAh"
                      value={plan.capacityMah}
                      min={0}
                      onValueChange={(capacityMah) => setPlan((p) => ({ ...p, capacityMah }))}
                    />
                    <NumberField
                      label="Uso máximo"
                      hint="% da capacidade"
                      value={plan.usablePct}
                      min={0}
                      max={100}
                      onValueChange={(usablePct) => setPlan((p) => ({ ...p, usablePct }))}
                    />
                    <NumberField
                      label="Duração da luta"
                      hint="segundos"
                      value={plan.durationSeconds}
                      min={0}
                      onValueChange={(durationSeconds) =>
                        setPlan((p) => ({ ...p, durationSeconds }))
                      }
                    />
                    <NumberField
                      label="Locomoção"
                      hint="A contínuos"
                      value={plan.driveCurrent}
                      min={0}
                      onValueChange={(driveCurrent) => setPlan((p) => ({ ...p, driveCurrent }))}
                    />
                    <NumberField
                      label="Reacelerações"
                      hint="vezes de 0 a 100 %"
                      value={plan.spinUps}
                      min={0}
                      onValueChange={(spinUps) => setPlan((p) => ({ ...p, spinUps }))}
                    />
                    <NumberField
                      label="Eficiência na aceleração"
                      hint="% bateria → arma (estimado)"
                      value={plan.spinUpEfficiencyPct}
                      min={1}
                      max={100}
                      onValueChange={(spinUpEfficiencyPct) =>
                        setPlan((p) => ({ ...p, spinUpEfficiencyPct }))
                      }
                    />
                  </div>
                </Card>
                <Card heading="Tempo em cada nível">
                  <div className="nt-params">
                    {PLAN_LEVELS.map((level) => (
                      <NumberField
                        key={level}
                        label={`Stick ${level} %`}
                        hint="segundos"
                        value={plan.seconds[level]}
                        min={0}
                        onValueChange={(value) => setSeconds(level, value)}
                      />
                    ))}
                  </div>
                  <div className="nt-defs nt-energy-defs">
                    <div className="nt-defs__row">
                      <span className="nt-defs__key">Arma em 0 % (ou girando solta)</span>
                      <span className="nt-defs__value">{fmt(budget.idleSeconds)} s</span>
                    </div>
                    {planned > plan.durationSeconds ? (
                      <div className="nt-defs__row">
                        <span className="nt-defs__key">Passou da duração da luta em</span>
                        <span className="nt-defs__value">
                          {fmt(planned - plan.durationSeconds)} s
                        </span>
                      </div>
                    ) : null}
                  </div>
                </Card>
              </div>

              <Card>
                <BudgetBar
                  capacity={plan.capacityMah}
                  usable={usableMah}
                  parts={[
                    { label: "Locomoção", mah: budget.driveMah, color: CHART_COLOR_VOLTAGE },
                    {
                      label: "Arma girando",
                      mah: budget.weaponSteadyMah,
                      color: CHART_COLOR_CURRENT,
                    },
                    { label: "Reacelerações", mah: budget.spinUpMah, color: CHART_COLOR_RPM },
                  ]}
                />
                <div style={{ marginTop: 16 }}>
                  <Alert variant={fits ? "success" : "danger"}>
                    {fits
                      ? `Cabe: o plano gasta ${fmt(budget.totalMah)} mAh e sobram ${fmt(budget.marginMah)} mAh do limite de ${fmt(usableMah)} mAh.`
                      : `Não cabe: o plano gasta ${fmt(budget.totalMah)} mAh, ${fmt(-budget.marginMah)} mAh acima do limite de ${fmt(usableMah)} mAh. Tire segundos dos níveis altos ou reacelerações.`}
                  </Alert>
                </div>
              </Card>
            </Section>

            <TestExplorer
              tests={measured.map((m) => m.test)}
              params={params}
              limitAmps={budget.weaponAverageLimit}
            />

            <Section
              title="Como cada conta foi feita"
              eyebrow="Passo a passo"
              subtitle="As mesmas contas da página com os números de agora. Mudar o plano, o teste base ou os parâmetros muda tudo aqui junto."
            >
              <div className="nt-energy-plan">
                <BudgetMath
                  capacityMah={plan.capacityMah}
                  usablePct={plan.usablePct}
                  durationSeconds={plan.durationSeconds}
                  driveCurrent={plan.driveCurrent}
                  spinUps={plan.spinUps}
                  spinUpEfficiencyPct={plan.spinUpEfficiencyPct}
                  shares={shares}
                  budget={budget}
                  curve={curve}
                  curveName={curveName}
                />
                <PointMath
                  tests={measured.map((m) => ({
                    id: m.test.id,
                    name: m.test.name,
                    rows: m.test.parsed.rows,
                    points: m.points,
                  }))}
                  params={params}
                  currentHeader={CURRENT_HEADER}
                />
              </div>
            </Section>

            <Section
              title="Parâmetros e fórmulas"
              eyebrow="Arma do Hai"
              subtitle="Valores da aba Arma da planilha de cálculos. Mudar aqui recalcula a página inteira."
            >
              <Card>
                <div className="nt-params">
                  <NumberField
                    label="KV do motor"
                    hint="rpm / volt"
                    value={params.kv}
                    min={0}
                    onValueChange={(kv) => setParams((p) => ({ ...p, kv }))}
                  />
                  <NumberField
                    label="Resistência"
                    hint="ohms (Ω)"
                    value={params.resistance}
                    min={0}
                    onValueChange={(resistance) => setParams((p) => ({ ...p, resistance }))}
                  />
                  <NumberField
                    label="Redução"
                    hint="motor : arma"
                    value={params.reduction}
                    min={0}
                    onValueChange={(reduction) => setParams((p) => ({ ...p, reduction }))}
                  />
                  <NumberField
                    label="Inércia da arma"
                    hint="kg·m²"
                    value={params.inertia}
                    min={0}
                    onValueChange={(inertia) => setParams((p) => ({ ...p, inertia }))}
                  />
                  <NumberField
                    label="Massa do robô"
                    hint="kg"
                    value={params.robotMass}
                    min={0}
                    onValueChange={(robotMass) => setParams((p) => ({ ...p, robotMass }))}
                  />
                  <NumberField
                    label="Células"
                    hint="S"
                    value={params.cells}
                    min={1}
                    onValueChange={(cells) => setParams((p) => ({ ...p, cells }))}
                  />
                </div>
              </Card>
              <Card heading="Como cada número sai">
                <div className="nt-defs">
                  <div className="nt-defs__row">
                    <span className="nt-defs__key">RPM (conta da planilha)</span>
                    <span className="nt-defs__value">KV · (S · 4 V) · stick / redução</span>
                  </div>
                  <div className="nt-defs__row">
                    <span className="nt-defs__key">Energia (J), com a RPM da planilha</span>
                    <span className="nt-defs__value">½ · I · ω²</span>
                  </div>
                  <div className="nt-defs__row">
                    <span className="nt-defs__key">Energia (m): altura que ergueria o robô</span>
                    <span className="nt-defs__value">I · ω² / (2 · g · massa)</span>
                  </div>
                  <div className="nt-defs__row">
                    <span className="nt-defs__key">Ponto de cada leitura do alicate</span>
                    <span className="nt-defs__value">
                      mediana do stick e média de V e I em ±1 s
                    </span>
                  </div>
                  <div className="nt-defs__row">
                    <span className="nt-defs__key">Custo de reacelerar</span>
                    <span className="nt-defs__value">E(100 %) / (V · eficiência)</span>
                  </div>
                  <div className="nt-defs__row">
                    <span className="nt-defs__key">Corrente média liberada para a arma</span>
                    <span className="nt-defs__value">
                      (limite − locomoção − reacelerações) / duração
                    </span>
                  </div>
                </div>
              </Card>
            </Section>
          </>
        ) : null}
      </div>
    </main>
  );
}
