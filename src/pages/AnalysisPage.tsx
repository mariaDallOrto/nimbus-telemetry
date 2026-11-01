import { useEffect, useMemo, useState, type ChangeEvent, type DragEvent } from "react";
import { useSearchParams } from "react-router-dom";
import { Alert } from "../components/Alert";
import { Card } from "../components/Card";
import { MotorParams } from "../components/MotorParams";
import { Section } from "../components/Section";
import { currentColumn, defaultLogSignals, logSignals, RPM_COLUMN } from "../charts/logSignals";
import { ELAPSED_TICK_STEPS, formatElapsed } from "../charts/plotOptions";
import { SignalExplorer, useSignalSelection } from "../charts/SignalExplorer";
import {
  CsvParseError,
  elapsedSeconds,
  numericColumn,
  parseCsv,
  type CsvValue,
  type ParsedCsv,
} from "../telemetry/csv";
import { generateMockLog } from "../telemetry/mockLog";
import { estimateRpm } from "../telemetry/rpm";
import { useTelemetry } from "../telemetry/TelemetryContext";
import { intOrDash } from "../ui/format";

const ROW_LIMIT = 200;
function rpmSourceColumns(headers: readonly string[]): string[] {
  return ["TensaoTotal_V", "Comando_Pct", currentColumn(headers)];
}

type ExampleLog = {
  id: string;
  /** Generated in the browser instead of fetched from /public/examples. */
  file: string | { generate: () => string };
  name: string;
  description: string;
};

/** Sample logs bundled in /public/examples, grouped by section and sorted oldest first. */
const EXAMPLE_SECTIONS: { title: string; logs: ExampleLog[] }[] = [
  ...(import.meta.env.DEV
    ? [
        {
          title: "Dados simulados",
          logs: [
            {
              id: "simulado",
              file: { generate: generateMockLog },
              name: "Log simulado",
              description:
                "2 min falsos: rampa, socos, queda de bateria, RSSI ruim, perda de pacotes e alicate.",
            },
          ],
        },
      ]
    : []),
  {
    title: "Anteriores",
    logs: [
      {
        id: "teste-paje",
        file: "test_paje.csv",
        name: "Teste Pajé",
        description: "Teste de demonstração gravado para mostrar ao Pajé.",
      },
      {
        id: "pico",
        file: "pico.csv",
        name: "Pico",
        description: "Teste para validar o pico de corrente da arma.",
      },
      {
        id: "pico-balta-luta",
        file: "pico_balta_luta.csv",
        name: "Pico Balta (luta)",
        description: "Pico do jeito que o Balta acelera a arma em luta.",
      },
      {
        id: "pico-balta-luta-2",
        file: "pico_balta_luta2.csv",
        name: "Pico Balta (luta) · 2",
        description: "Segunda captura do pico com o Balta acelerando em luta.",
      },
    ],
  },
  {
    title: "24/10/2026",
    logs: [
      {
        id: "bateria-acabando",
        file: "2026-10-24/14h23.csv",
        name: "Bateria acabando",
        description: "Gravado às 14h23 com a bateria já descarregada (~15,5 V em repouso).",
      },
      {
        id: "bateria-prime",
        file: "2026-10-24/14h38.csv",
        name: "Bateria prime",
        description: "Gravado às 14h38 com a bateria cheia (~16,7 V em repouso).",
      },
    ],
  },
  {
    title: "T-Motor · 31/10/2026",
    logs: [
      {
        id: "t-motor-normal-serial",
        file: "2026-10-31/normal-serial.csv",
        name: "Normal",
        description: "Log completo do teste normal, 1m40s sem perda de pacotes (média até 17 A).",
      },
      {
        id: "t-motor-pico-luta-serial",
        file: "2026-10-31/pico-luta-serial.csv",
        name: "Pico de luta",
        description: "Log completo do pico de luta, 1 min sem perda de pacotes (média até 32 A).",
      },
    ],
  },
];

const EXAMPLE_LOGS = EXAMPLE_SECTIONS.flatMap((section) => section.logs);
const EXAMPLE_QUERY_PARAM = "log";

async function exampleText(example: ExampleLog, signal: AbortSignal): Promise<string> {
  if (typeof example.file !== "string") return example.file.generate();
  const response = await fetch(`${import.meta.env.BASE_URL}examples/${example.file}`, { signal });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.text();
}

function numCell(value: CsvValue | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

type LoadedFile = {
  name: string;
  parsed: ParsedCsv;
  exampleId?: string | undefined;
  /** Remounts the chart on every load, even for a file with the same name. */
  loadedAt: number;
};

export default function AnalysisPage() {
  const { config } = useTelemetry();
  const [searchParams, setSearchParams] = useSearchParams();
  const exampleId = searchParams.get(EXAMPLE_QUERY_PARAM);
  const [file, setFile] = useState<LoadedFile | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const selection = useSignalSelection([]);
  const [independentScales, setIndependentScales] = useState(true);
  const [loadingExample, setLoadingExample] = useState<string | null>(null);

  // Estimated RPM per row, recomputed whenever the motor params change. When
  // the source columns are present we expose RPM_Est as a virtual column that
  // the chart and table treat like a logged one.
  const model = useMemo(() => {
    if (!file) return null;
    const sourceColumns = rpmSourceColumns(file.parsed.headers);
    const hasRpm = sourceColumns.every((column) => file.parsed.headers.includes(column));
    const rpm: (number | null)[] = file.parsed.rows.map((row) => {
      const voltage = numCell(row["TensaoTotal_V"]);
      const stickPct = numCell(row["Comando_Pct"]);
      const current = numCell(row[currentColumn(file.parsed.headers)]);
      if (voltage === null || stickPct === null || current === null) return null;
      return estimateRpm({ voltage, stickPct, current }, config);
    });
    const headers = hasRpm ? [...file.parsed.headers, RPM_COLUMN] : file.parsed.headers;
    return { headers, rpm, hasRpm };
  }, [file, config]);

  const elapsed = useMemo(() => (file ? elapsedSeconds(file.parsed.rows) : []), [file]);

  const signals = useMemo(() => {
    if (!file || !model) return [];
    return logSignals(model.headers, (header) =>
      header === RPM_COLUMN ? model.rpm : numericColumn(file.parsed.rows, header),
    );
  }, [file, model]);

  const defaultSignals = useMemo(() => defaultLogSignals(file?.parsed.headers ?? []), [file]);

  const loadCsvText = (name: string, text: string, loadedExampleId?: string) => {
    try {
      const parsed = parseCsv(text);
      setFile({ name, parsed, exampleId: loadedExampleId, loadedAt: performance.now() });
      setError(null);
      selection.reset(defaultLogSignals(parsed.headers));
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

  useEffect(() => {
    const example = EXAMPLE_LOGS.find((candidate) => candidate.id === exampleId);
    if (!example) {
      setFile((current) => (current?.exampleId ? null : current));
      return;
    }
    const controller = new AbortController();
    setError(null);
    setLoadingExample(example.id);
    exampleText(example, controller.signal)
      .then((text) => loadCsvText(example.name, text, example.id))
      .catch((caught) => {
        if (controller.signal.aborted) return;
        setError(`Não foi possível carregar o exemplo "${example.name}".`);
        console.error("example log fetch failed", caught);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoadingExample(null);
      });
    return () => controller.abort();
  }, [exampleId]);

  const openExample = (example: ExampleLog) =>
    setSearchParams({ [EXAMPLE_QUERY_PARAM]: example.id });

  const backToStart = () => {
    setFile(null);
    setSearchParams({});
  };

  const handleDrop = (event: DragEvent<HTMLLabelElement>) => {
    event.preventDefault();
    setDragOver(false);
    readFile(event.dataTransfer.files?.[0]);
  };

  const rowCount = file?.parsed.rows.length ?? 0;
  const shownRows = Math.min(rowCount, ROW_LIMIT);

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
              Carregue um log gravado no cartão SD do ESP32 para ver corrente, stick e tensão,
              escolher outros sinais e inspecionar os dados brutos.
            </p>
          </div>
        </header>

        {file ? (
          <Card
            action={
              <div className="nt-file-actions">
                <button type="button" className="nb-btn nb-btn--secondary" onClick={backToStart}>
                  ← Voltar
                </button>
                <label className="nb-btn nb-btn--secondary" style={{ cursor: "pointer" }}>
                  Trocar arquivo
                  <input
                    type="file"
                    accept=".csv"
                    className="nb-visually-hidden"
                    onChange={handleInput}
                  />
                </label>
              </div>
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

            <div className="nt-examples">
              <div className="nt-examples__title">Ou comece com um exemplo</div>
              {EXAMPLE_SECTIONS.map((section) => (
                <section key={section.title} className="nt-examples__section">
                  <h3 className="nt-examples__section-title">{section.title}</h3>
                  <div className="nt-examples__grid">
                    {section.logs.map((example) => (
                      <button
                        key={example.id}
                        type="button"
                        className="nt-example"
                        disabled={loadingExample !== null}
                        aria-busy={loadingExample === example.id}
                        onClick={() => openExample(example)}
                      >
                        <span className="nt-example__name">{example.name}</span>
                        <span className="nt-example__desc">{example.description}</span>
                        <span className="nt-example__cta" aria-hidden>
                          {loadingExample === example.id ? "Carregando…" : "Abrir exemplo →"}
                        </span>
                      </button>
                    ))}
                  </div>
                </section>
              ))}
            </div>
          </>
        )}

        {file ? (
          <>
            <Section
              title="Sinais"
              eyebrow="Gráfico"
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
              <Card>
                <SignalExplorer
                  key={file.loadedAt}
                  x={elapsed}
                  signals={signals}
                  selection={selection}
                  defaults={defaultSignals}
                  ariaLabel={`Sinais selecionados do log ${file.name}`}
                  formatX={formatElapsed}
                  xSteps={ELAPSED_TICK_STEPS}
                  sharedScale={!independentScales}
                />
              </Card>
            </Section>

            <Section
              title="Parâmetros do motor"
              eyebrow="RPM estimado"
              subtitle="KV, resistência e redução alimentam o sinal RPM estimado. Ajuste para estimar o RPM correto."
            >
              <Card>
                <MotorParams />
              </Card>
              {model && !model.hasRpm ? (
                <div style={{ marginTop: 14 }}>
                  <Alert variant="info">
                    RPM não calculado: o log não tem as colunas{" "}
                    {rpmSourceColumns(file?.parsed.headers ?? []).join(", ")}.
                  </Alert>
                </div>
              ) : null}
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
