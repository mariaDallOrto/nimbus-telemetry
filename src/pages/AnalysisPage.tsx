import { useMemo, useState, type ChangeEvent, type DragEvent } from "react";
import { Alert } from "../components/Alert";
import { Card } from "../components/Card";
import { MotorParams } from "../components/MotorParams";
import { NumberInput } from "../components/NumberInput";
import { Section } from "../components/Section";
import { MiniChart } from "../charts/MiniChart";
import { SeriesChart, type ChartSeries } from "../charts/SeriesChart";
import {
  CHART_COLOR_CURRENT,
  CHART_COLOR_RPM,
  CHART_COLOR_RSSI,
  CHART_COLOR_STICK,
  CHART_COLOR_VOLTAGE,
  seriesColor,
} from "../charts/chartColors";
import {
  CsvParseError,
  numericColumn,
  parseCsv,
  temporalLabels,
  type CsvValue,
  type ParsedCsv,
} from "../telemetry/csv";
import { movingAverage } from "../telemetry/movingAverage";
import { estimateRpm } from "../telemetry/rpm";
import { useTelemetry } from "../telemetry/TelemetryContext";
import { intOrDash } from "../ui/format";

const ROW_LIMIT = 200;
/** Derived (not logged) column: RPM estimated from voltage, stick and current. */
const RPM_COLUMN = "RPM_Est";
const RPM_SOURCE_COLUMNS = ["TensaoTotal_V", "Comando_Pct", "Corrente_A"];
const DEFAULT_SELECTED = ["Corrente_A", "TensaoTotal_V", "Comando_Pct", "RSSI_dBm", RPM_COLUMN];
const EXCLUDED_COLUMNS = new Set(["Timestamp", "PacketID"]);

const COLUMN_COLORS: Record<string, string> = {
  Corrente_A: CHART_COLOR_CURRENT,
  TensaoTotal_V: CHART_COLOR_VOLTAGE,
  Comando_Pct: CHART_COLOR_STICK,
  RSSI_dBm: CHART_COLOR_RSSI,
  [RPM_COLUMN]: CHART_COLOR_RPM,
};

const OVERVIEW_CHARTS = [
  { key: "Corrente_A", label: "Corrente (A)", color: CHART_COLOR_CURRENT },
  { key: "TensaoTotal_V", label: "Tensão (V)", color: CHART_COLOR_VOLTAGE },
  { key: "Comando_Pct", label: "Stick (%)", color: CHART_COLOR_STICK },
  { key: RPM_COLUMN, label: "RPM Est.", color: CHART_COLOR_RPM },
  { key: "RSSI_dBm", label: "RSSI (dBm)", color: CHART_COLOR_RSSI },
] as const;

function isPlottable(header: string): boolean {
  return !EXCLUDED_COLUMNS.has(header) && !header.toLowerCase().includes("time");
}

function columnColor(header: string, index: number): string {
  return COLUMN_COLORS[header] ?? seriesColor(index);
}

function numCell(value: CsvValue | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

type LoadedFile = { name: string; parsed: ParsedCsv };

export default function AnalysisPage() {
  const { config } = useTelemetry();
  const [file, setFile] = useState<LoadedFile | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [maByColumn, setMaByColumn] = useState<Record<string, number>>({});
  const [independentScales, setIndependentScales] = useState(true);

  // Estimated RPM per row, recomputed whenever the motor params change. When
  // the source columns are present we expose RPM_Est as a virtual column that
  // the chart, overview, smoothing and table all treat like a logged one.
  const model = useMemo(() => {
    if (!file) return null;
    const hasRpm = RPM_SOURCE_COLUMNS.every((column) => file.parsed.headers.includes(column));
    const rpm: (number | null)[] = file.parsed.rows.map((row) => {
      const voltage = numCell(row["TensaoTotal_V"]);
      const stickPct = numCell(row["Comando_Pct"]);
      const current = numCell(row["Corrente_A"]);
      if (voltage === null || stickPct === null || current === null) return null;
      return estimateRpm({ voltage, stickPct, current }, config);
    });
    const headers = hasRpm ? [...file.parsed.headers, RPM_COLUMN] : file.parsed.headers;
    return { headers, rpm, hasRpm };
  }, [file, config]);

  const plottableColumns = useMemo(() => (model ? model.headers.filter(isPlottable) : []), [model]);

  const labels = useMemo(() => (file ? temporalLabels(file.parsed.rows) : []), [file]);

  const columnSeries = (header: string): (number | null)[] => {
    if (!file) return [];
    if (header === RPM_COLUMN) return model?.rpm ?? [];
    return numericColumn(file.parsed.rows, header);
  };

  const customSeries = useMemo<ChartSeries[]>(() => {
    if (!file || !model) return [];
    return plottableColumns
      .filter((header) => selected.has(header))
      .map((header, index) => {
        const window = maByColumn[header] ?? 1;
        const raw = header === RPM_COLUMN ? model.rpm : numericColumn(file.parsed.rows, header);
        return {
          label: window > 1 ? `${header} (MM${window})` : header,
          data: movingAverage(raw, window),
          color: columnColor(header, index),
        };
      });
  }, [file, model, plottableColumns, selected, maByColumn]);

  const loadCsvText = (name: string, text: string) => {
    try {
      const parsed = parseCsv(text);
      const hasRpm = RPM_SOURCE_COLUMNS.every((column) => parsed.headers.includes(column));
      setFile({ name, parsed });
      setError(null);
      setSelected(
        new Set(
          DEFAULT_SELECTED.filter((column) =>
            column === RPM_COLUMN ? hasRpm : parsed.headers.includes(column),
          ),
        ),
      );
      setMaByColumn({});
    } catch (caught) {
      setFile(null);
      setError(caught instanceof CsvParseError ? caught.message : "Falha ao ler o arquivo.");
    }
  };

  const readFile = (selectedFile: File | undefined) => {
    if (!selectedFile) return;
    const reader = new FileReader();
    reader.onload = (event) => loadCsvText(selectedFile.name, String(event.target?.result ?? ""));
    reader.onerror = () => setError("Não foi possível ler o arquivo.");
    reader.readAsText(selectedFile);
  };

  const handleInput = (event: ChangeEvent<HTMLInputElement>) => readFile(event.target.files?.[0]);

  const handleDrop = (event: DragEvent<HTMLLabelElement>) => {
    event.preventDefault();
    setDragOver(false);
    readFile(event.dataTransfer.files?.[0]);
  };

  const toggleColumn = (header: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(header)) next.delete(header);
      else next.add(header);
      return next;
    });
  };

  const setColumnMa = (header: string, value: number) => {
    setMaByColumn((prev) => ({ ...prev, [header]: Math.max(1, value || 1) }));
  };

  const rowCount = file?.parsed.rows.length ?? 0;
  const shownRows = Math.min(rowCount, ROW_LIMIT);
  const overviewCharts = OVERVIEW_CHARTS.filter((chart) =>
    chart.key === RPM_COLUMN ? model?.hasRpm : file?.parsed.headers.includes(chart.key),
  );

  return (
    <main className="nb-main">
      <div className="nb-content">
        <header className="nb-hero">
          <div>
            <div className="nb-hero__eyebrow">
              <span className="nb-hero__eyebrow-dot" aria-hidden />
              <span>Pós-análise de logs</span>
            </div>
            <h1 className="nb-hero__title">Análise de CSV</h1>
            <p className="nb-hero__lede">
              Carregue um log gravado no cartão SD do ESP32 para montar gráficos personalizados,
              suavizar séries e inspecionar os dados brutos.
            </p>
          </div>
        </header>

        {file ? (
          <Card
            action={
              <label className="nb-btn nb-btn--secondary" style={{ cursor: "pointer" }}>
                Trocar arquivo
                <input
                  type="file"
                  accept=".csv"
                  className="nb-visually-hidden"
                  onChange={handleInput}
                />
              </label>
            }
          >
            <div className="nt-file-summary">
              <span className="nt-file-summary__icon" aria-hidden>
                📄
              </span>
              <div>
                <div className="nt-file-summary__name">{file.name}</div>
                <div className="nt-file-summary__meta">
                  {rowCount} linhas · {file.parsed.headers.length} colunas
                </div>
              </div>
            </div>
          </Card>
        ) : (
          <>
            {error ? (
              <div style={{ marginBottom: 16 }}>
                <Alert variant="danger">{error}</Alert>
              </div>
            ) : null}
            <label
              className={`nt-dropzone${dragOver ? " is-dragover" : ""}`}
              onDragOver={(event) => {
                event.preventDefault();
                setDragOver(true);
              }}
              onDragLeave={() => setDragOver(false)}
              onDrop={handleDrop}
            >
              <input
                type="file"
                accept=".csv"
                className="nb-visually-hidden"
                onChange={handleInput}
              />
              <span className="nt-dropzone__icon" aria-hidden>
                📂
              </span>
              <span className="nt-dropzone__title">Carregar arquivo de log (.csv)</span>
              <span className="nt-dropzone__hint">
                Arraste o arquivo baixado do ESP32 aqui, ou clique para selecionar.
              </span>
            </label>
          </>
        )}

        {file ? (
          <>
            <Section
              title="Parâmetros do motor"
              eyebrow="RPM estimado"
              subtitle="KV, resistência e redução alimentam a coluna RPM_Est — ajuste para estimar o RPM correto."
            >
              <Card>
                <MotorParams />
              </Card>
              {model && !model.hasRpm ? (
                <div style={{ marginTop: 14 }}>
                  <Alert variant="info">
                    RPM não calculado: o log não tem as colunas {RPM_SOURCE_COLUMNS.join(", ")}.
                  </Alert>
                </div>
              ) : null}
            </Section>

            <Section
              title="Gráfico personalizado"
              eyebrow="Selecione as colunas"
              subtitle="As linhas marcadas aparecem no gráfico. A suavização é controlada por coluna abaixo."
              action={
                <div className="nt-segmented" role="group" aria-label="Escala dos eixos">
                  <button
                    type="button"
                    className={`nt-segmented__option${independentScales ? " is-active" : ""}`}
                    aria-pressed={independentScales}
                    onClick={() => setIndependentScales(true)}
                    title="Cada série na sua própria escala"
                  >
                    Escala por série
                  </button>
                  <button
                    type="button"
                    className={`nt-segmented__option${independentScales ? "" : " is-active"}`}
                    aria-pressed={!independentScales}
                    onClick={() => setIndependentScales(false)}
                    title="Todas as séries na mesma escala"
                  >
                    Compartilhada
                  </button>
                </div>
              }
            >
              <div style={{ marginBottom: 18 }}>
                <div className="nt-toggle-grid">
                  {plottableColumns.map((header) => {
                    const on = selected.has(header);
                    return (
                      <button
                        key={header}
                        type="button"
                        className={`nt-toggle${on ? " is-on" : ""}`}
                        aria-pressed={on}
                        onClick={() => toggleColumn(header)}
                      >
                        <span className="nt-toggle__dot" aria-hidden />
                        {header}
                      </button>
                    );
                  })}
                </div>
              </div>
              <Card bodyPadding={false}>
                <div style={{ padding: 18 }}>
                  {customSeries.length > 0 ? (
                    <SeriesChart
                      labels={labels}
                      series={customSeries}
                      ariaLabel="Gráfico personalizado"
                      independentScales={independentScales}
                    />
                  ) : (
                    <div className="nt-empty">
                      <span className="nt-empty__icon" aria-hidden>
                        📊
                      </span>
                      <span className="nt-empty__title">Nenhuma coluna selecionada</span>
                      <span className="nt-empty__hint">
                        Marque ao menos uma coluna acima para montar o gráfico.
                      </span>
                    </div>
                  )}
                </div>
              </Card>
            </Section>

            <Section
              title="Média móvel por linha"
              eyebrow="Suavização"
              subtitle="Janela em pontos — 1 mantém o sinal original."
            >
              <div className="nt-ma-list">
                {plottableColumns.map((header) => {
                  const window = maByColumn[header] ?? 1;
                  return (
                    <div key={header} className="nt-ma-row">
                      <span className="nt-ma-row__name">{header}</span>
                      <div className="nt-ma-row__controls">
                        <input
                          type="range"
                          min={1}
                          max={50}
                          value={Math.min(window, 50)}
                          aria-label={`Média móvel de ${header}`}
                          onChange={(event) =>
                            setColumnMa(header, Number.parseInt(event.target.value, 10))
                          }
                        />
                        <NumberInput
                          value={window}
                          min={1}
                          max={200}
                          aria-label={`Janela da média móvel de ${header}`}
                          onValueChange={(next) => setColumnMa(header, next)}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            </Section>

            <Section title="Visão geral dos sensores" eyebrow="Resumo">
              <div className="nt-overview">
                {overviewCharts.map((chart) => (
                  <Card key={chart.key} heading={chart.label}>
                    <MiniChart
                      labels={labels}
                      data={columnSeries(chart.key)}
                      color={chart.color}
                      label={chart.label}
                    />
                  </Card>
                ))}
              </div>
            </Section>

            <Section
              title="Dados brutos"
              eyebrow="Tabela"
              action={
                <span className="nb-section__subtitle">
                  {shownRows} de {rowCount} linhas
                </span>
              }
            >
              <Card bodyPadding={false}>
                <div className="nb-table-scroll">
                  <table className="nb-table">
                    <thead>
                      <tr>
                        {model?.headers.map((header) => (
                          <th key={header}>{header}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {file.parsed.rows.slice(0, ROW_LIMIT).map((row, index) => (
                        <tr key={String(row["PacketID"] ?? Object.values(row).join("|"))}>
                          {model?.headers.map((header) => (
                            <td key={header}>
                              {header === RPM_COLUMN
                                ? intOrDash(model.rpm[index] ?? null)
                                : String(row[header] ?? "")}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </Card>
            </Section>
          </>
        ) : null}
      </div>
    </main>
  );
}
