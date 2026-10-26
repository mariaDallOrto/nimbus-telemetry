import { useId, useState } from "react";
import { Card } from "../components/Card";
import type { CsvRow } from "../telemetry/csv";
import {
  GRAVITY,
  consumedMah,
  interpolate,
  logDurationSeconds,
  type FightBudget,
  type StickPoint,
  type WeaponCurve,
  type WeaponParams,
} from "../telemetry/energy";

export function fmt(value: number, digits = 0): string {
  if (!Number.isFinite(value)) return "—";
  return value.toLocaleString("pt-BR", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

/** Parameter as typed, without padding or rounding (0,00018206 stays whole). */
function raw(value: number): string {
  return value.toLocaleString("pt-BR", { maximumFractionDigits: 8 });
}

type Step = { title: string; formula: string; work: string; result?: string; note?: string };

function Steps({ steps }: { steps: readonly Step[] }) {
  return (
    <ol className="nt-steps">
      {steps.map((step) => (
        <li key={step.title} className="nt-steps__item">
          <div className="nt-steps__title">{step.title}</div>
          <div className="nt-steps__formula">{step.formula}</div>
          <div className="nt-steps__work">
            <code>{step.work}</code>
            {step.result ? <strong className="nt-steps__result">= {step.result}</strong> : null}
          </div>
          {step.note ? <p className="nt-steps__note">{step.note}</p> : null}
        </li>
      ))}
    </ol>
  );
}

type Pair = readonly [number, number];

/** The two curve samples around `value` on the given axis (0 = stick, 1 = y). */
function around(points: readonly Pair[], value: number, axis: 0 | 1): [Pair, Pair] | null {
  const sorted = [...points].sort((a, b) => a[0] - b[0]);
  for (let i = 1; i < sorted.length; i++) {
    const a = sorted[i - 1];
    const b = sorted[i];
    if (a && b && value <= b[axis]) return [a, b];
  }
  return null;
}

function between(pair: [Pair, Pair] | null, unit: string, digits: number): string {
  if (!pair) return "acima do maior ponto medido, usa o último";
  const [a, b] = pair;
  return `entre ${fmt(a[0])} % (${fmt(a[1], digits)} ${unit}) e ${fmt(b[0])} % (${fmt(b[1], digits)} ${unit})`;
}

type BudgetMathProps = {
  capacityMah: number;
  usablePct: number;
  durationSeconds: number;
  driveCurrent: number;
  spinUps: number;
  spinUpEfficiencyPct: number;
  shares: readonly { stickPct: number; seconds: number }[];
  budget: FightBudget;
  curve: WeaponCurve;
  curveName: string;
};

export function BudgetMath({
  capacityMah,
  usablePct,
  durationSeconds,
  driveCurrent,
  spinUps,
  spinUpEfficiencyPct,
  shares,
  budget,
  curve,
  curveName,
}: BudgetMathProps) {
  const top = [...curve.joules].sort((a, b) => a[0] - b[0]).at(-1) ?? [0, 0];
  const topVoltage = interpolate(curve.voltage, 100);
  const weaponMah = budget.budgetMah - budget.driveMah - budget.spinUpMah;
  const currentPair = around(curve.current, budget.weaponAverageLimit, 1);
  const joulesPair = around(curve.joules, budget.continuousStickPct, 0);
  const fullCurrent = interpolate(curve.current, 100);
  const active = shares.filter((share) => share.seconds > 0);

  const limit: Step[] = [
    {
      title: "Limite de uso da bateria",
      formula: "capacidade × uso máximo",
      work: `${fmt(capacityMah)} mAh × ${fmt(usablePct)} %`,
      result: `${fmt(budget.budgetMah)} mAh`,
      note: "1 mAh = 3,6 A·s, por isso o ÷ 3,6 nas contas de carga abaixo.",
    },
    {
      title: "Locomoção",
      formula: "corrente × duração ÷ 3,6",
      work: `${fmt(driveCurrent, 1)} A × ${fmt(durationSeconds)} s ÷ 3,6`,
      result: `${fmt(budget.driveMah)} mAh`,
    },
    {
      title: "Energia guardada no topo da curva",
      formula: `RPM da planilha no ponto mais alto do ${curveName} (conta completa em “Um ponto medido”)`,
      work: `stick ${fmt(top[0])} %, bateria a ${fmt(topVoltage, 2)} V`,
      result: `${fmt(top[1])} J`,
    },
    {
      title: "Custo de uma reaceleração",
      formula: "energia ÷ (tensão × eficiência) ÷ 3,6",
      work: `${fmt(top[1])} J ÷ (${fmt(topVoltage, 2)} V × ${fmt(spinUpEfficiencyPct)} %) ÷ 3,6`,
      result: `${fmt(budget.spinUpMahEach, 1)} mAh`,
      note: "Carga que a bateria entrega para levar a arma de parada até o topo. A eficiência é estimada.",
    },
    {
      title: "Todas as reacelerações",
      formula: "custo de uma × quantidade",
      work: `${fmt(budget.spinUpMahEach, 1)} mAh × ${fmt(spinUps)}`,
      result: `${fmt(budget.spinUpMah)} mAh`,
    },
    {
      title: "Sobra para a arma girando",
      formula: "limite − locomoção − reacelerações",
      work: `${fmt(budget.budgetMah)} − ${fmt(budget.driveMah)} − ${fmt(budget.spinUpMah)}`,
      result: `${fmt(weaponMah)} mAh`,
    },
    {
      title: "Corrente média liberada para a arma",
      formula: "sobra × 3,6 ÷ duração",
      work: `${fmt(weaponMah)} mAh × 3,6 ÷ ${fmt(durationSeconds)} s`,
      result: `${fmt(budget.weaponAverageLimit, 1)} A`,
    },
    {
      title: "Stick contínuo equivalente",
      formula: `onde a curva de corrente do ${curveName} chega nessa média (interpolação linear)`,
      work: between(currentPair, "A", 1),
      result: `${fmt(budget.continuousStickPct)} %`,
    },
    {
      title: "Energia nesse stick",
      formula: "mesma interpolação, na curva de energia",
      work: between(joulesPair, "J", 0),
      result: `${fmt(budget.continuousJoules)} J`,
    },
    {
      title: "Tempo em 100 % com o resto em 0",
      formula: "sobra × 3,6 ÷ corrente em 100 %",
      work: `${fmt(weaponMah)} mAh × 3,6 ÷ ${fmt(fullCurrent, 1)} A`,
      result: `${fmt(budget.fullThrottleSeconds)} s`,
    },
  ];

  const plan: Step[] = [
    ...active.map((share) => {
      const current = interpolate(curve.current, share.stickPct);
      return {
        title: `Arma em ${fmt(share.stickPct)} % por ${fmt(share.seconds)} s`,
        formula: "corrente na curva × segundos ÷ 3,6",
        work: `${fmt(current, 1)} A × ${fmt(share.seconds)} s ÷ 3,6`,
        result: `${fmt((current * share.seconds) / 3.6)} mAh`,
      };
    }),
    {
      title: "Total do plano",
      formula: "locomoção + arma girando + reacelerações",
      work: `${fmt(budget.driveMah)} + ${fmt(budget.weaponSteadyMah)} + ${fmt(budget.spinUpMah)}`,
      result: `${fmt(budget.totalMah)} mAh`,
    },
    {
      title: budget.marginMah >= 0 ? "Sobra do limite" : "Estouro do limite",
      formula: "limite − total do plano",
      work: `${fmt(budget.budgetMah)} − ${fmt(budget.totalMah)}`,
      result: `${fmt(budget.marginMah)} mAh`,
    },
  ];

  return (
    <Card heading="Bateria: do limite até a corrente média">
      <Steps steps={limit} />
      <h3 className="nt-steps__heading">Conferindo o plano de luta</h3>
      <Steps steps={plan} />
    </Card>
  );
}

type PointMathTest = {
  id: string;
  name: string;
  rows: readonly CsvRow[];
  points: readonly StickPoint[];
};

export function PointMath({
  tests,
  params,
  currentHeader,
}: {
  tests: readonly PointMathTest[];
  params: WeaponParams;
  currentHeader: string;
}) {
  const testSelectId = useId();
  const pointSelectId = useId();
  const [testId, setTestId] = useState(tests.at(-1)?.id ?? "");
  const [pointRow, setPointRow] = useState<number | null>(null);
  const test = tests.find((t) => t.id === testId) ?? tests[0];
  if (!test) return null;
  const top = test.points.reduce<StickPoint | undefined>(
    (best, p) => (!best || p.stickHeld > best.stickHeld ? p : best),
    undefined,
  );
  const point = test.points.find((p) => p.row === pointRow) ?? top;
  if (!point) return null;

  const duty = point.stickHeld / 100;
  const omegaS = (point.rpmSheet * 2 * Math.PI) / 60;
  const duration = logDurationSeconds(test.rows);
  const dtMs = (1000 * duration) / test.rows.length;

  const steps: Step[] = [
    {
      title: "Janela em volta da leitura do alicate",
      formula: "41 linhas do log (±20, uns 2 s); mediana do stick",
      work: `linha ${fmt(point.row + 2)} do CSV, stick anotado ${fmt(point.stickSet)} %, alicate ${fmt(point.clamp, 1)} A`,
      result: `stick ${fmt(point.stickHeld)} %`,
      note: "A mediana ignora os picos do stick e pega o patamar que ficou segurado.",
    },
    {
      title: "Tensão e corrente do patamar",
      formula: "média das linhas a até 3 % da mediana do stick",
      work: `${fmt(point.samples)} linhas: V = ${fmt(point.voltage, 2)} V, I = ${fmt(point.current, 1)} A`,
    },
    {
      title: "RPM",
      formula: "KV × (S × 4 V) × stick ÷ redução",
      work: `${raw(params.kv)} × (${raw(params.cells)} × ${raw(params.voltsPerCell)} V) × ${fmt(duty, 2)} ÷ ${raw(params.reduction)}`,
      result: `${fmt(point.rpmSheet)} rpm`,
      note: "Conta da planilha: bateria fixa em 4 V por célula e sem perda no motor.",
    },
    {
      title: "Velocidade angular",
      formula: "rpm da planilha × 2π ÷ 60",
      work: `${fmt(point.rpmSheet)} × 2π ÷ 60`,
      result: `${fmt(omegaS)} rad/s`,
    },
    {
      title: "Energia guardada",
      formula: "½ × I × ω²",
      work: `½ × ${raw(params.inertia)} kg·m² × ${fmt(omegaS)}²`,
      result: `${fmt(point.energySheet.joules)} J`,
    },
    {
      title: "Energia em metros",
      formula: "energia ÷ (massa do robô × g): altura que ergueria o robô",
      work: `${fmt(point.energySheet.joules)} J ÷ (${raw(params.robotMass)} kg × ${raw(GRAVITY)} m/s²)`,
      result: `${fmt(point.energySheet.meters, 1)} m`,
    },
    {
      title: "Consumo do teste inteiro",
      formula: "soma de I × Δt ÷ 3,6, com Δt = duração ÷ linhas",
      work: `Δt = ${fmt(duration)} s ÷ ${fmt(test.rows.length)} linhas = ${fmt(dtMs)} ms`,
      result: `${fmt(consumedMah(test.rows, currentHeader))} mAh`,
      note: "O log só tem segundos inteiros, então Δt é a média; corrente negativa (frenagem) não entra.",
    },
  ];

  return (
    <Card heading="Um ponto medido: do log até a energia">
      <div className="nt-params nt-steps__pick">
        <div className="nb-field">
          <label className="nb-field__label" htmlFor={testSelectId}>
            Teste
          </label>
          <select
            id={testSelectId}
            className="nb-field__input"
            value={test.id}
            onChange={(event) => {
              setTestId(event.target.value);
              setPointRow(null);
            }}
          >
            {tests.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        </div>
        <div className="nb-field">
          <label className="nb-field__label" htmlFor={pointSelectId}>
            Ponto
          </label>
          <select
            id={pointSelectId}
            className="nb-field__input"
            value={point.row}
            onChange={(event) => setPointRow(Number(event.target.value))}
          >
            {test.points.map((p) => (
              <option key={p.row} value={p.row}>
                {`${fmt(p.stickSet)} % (mantido ${fmt(p.stickHeld)} %)`}
              </option>
            ))}
          </select>
        </div>
      </div>
      <Steps steps={steps} />
    </Card>
  );
}
