import { useMemo, useState } from "react";
import { Alert } from "../components/Alert";
import { Button } from "../components/Button";
import { Card } from "../components/Card";
import { ConnectionStatusBadge } from "../components/ConnectionStatusBadge";
import { Field } from "../components/Field";
import { MetricRow, MetricTile } from "../components/MetricTile";
import { NumberInput } from "../components/NumberInput";
import { Section } from "../components/Section";
import {
  CHART_COLOR_CURRENT,
  CHART_COLOR_CURRENT_MIN,
  CHART_COLOR_CURRENT_PEAK,
  CHART_COLOR_RSSI,
  CHART_COLOR_STICK,
  CHART_COLOR_VOLTAGE,
} from "../charts/chartColors";
import { formatClock, SECOND_TICK_STEPS } from "../charts/plotOptions";
import { SignalExplorer, useSignalSelection, type Signal } from "../charts/SignalExplorer";
import { movingAverage } from "../telemetry/movingAverage";
import { isSerialSupported } from "../telemetry/serialLink";
import { useTelemetry } from "../telemetry/TelemetryContext";
import type { ConnectionStatus } from "../telemetry/types";
import { fixedOrDash, intOrDash, lastNumber } from "../ui/format";

const SD_ERROR_MARKER = "ERRO_SD";

const LIVE_DEFAULTS = [
  { id: "current", movingAverage: 20 },
  { id: "stick", movingAverage: 5 },
  { id: "voltage", movingAverage: 15 },
];
const CURRENT_LOOK = { group: "Corrente", unit: "A", scaleGroup: "current", digits: 1 } as const;

const SERIAL_PORT_STATE: Record<ConnectionStatus, string> = {
  offline: "Ligue o ESP32 no USB e escolha a porta",
  connecting: "Abrindo a porta",
  online: "Porta conectada",
  reconnecting: "Procurando o cabo",
};

function isValidHost(ip: string): boolean {
  const trimmed = ip.trim();
  return trimmed.length > 0 && !/\s/.test(trimmed);
}

function formatKilobytes(characters: number): string {
  return `${(characters / 1024).toFixed(0)} KB`;
}

function formatSampleCount(samples: number): string {
  return `${samples} ${samples === 1 ? "amostra" : "amostras"}`;
}

export default function LivePage() {
  const {
    status,
    serialStatus,
    config,
    setConfig,
    recording,
    lastSample,
    buffers,
    sampleVersion,
    connect,
    disconnect,
    connectSerial,
    disconnectSerial,
    sendCommand,
    browserRecording,
    startRecording,
    stopRecording,
    savedLogs,
    downloadSavedLog,
    deleteSavedLog,
    logStoreFailed,
    calibratedAt,
  } = useTelemetry();

  const selection = useSignalSelection(LIVE_DEFAULTS);
  const [visibleWindow, setVisibleWindow] = useState(80);
  const [isPaused, setIsPaused] = useState(false);
  const [isConfirmingCalibration, setIsConfirmingCalibration] = useState(false);

  const isWifiOnline = status === "online";
  const isSerialOnline = serialStatus === "online";
  const isOnline = isWifiOnline || isSerialOnline;
  const isWifiConnecting = status === "connecting" || status === "reconnecting";
  const isSerialConnecting = serialStatus === "connecting" || serialStatus === "reconnecting";
  const ipValid = isValidHost(config.ip);
  const isSdRecording = recording?.phase === "started";
  const isRecording = browserRecording.isActive || isSdRecording;
  const sdFailed = recording?.file === SD_ERROR_MARKER;
  const downloadFile =
    recording?.phase === "stopped" && recording.file && recording.file !== SD_ERROR_MARKER
      ? recording.file
      : null;

  // Buffers mutate in place, so each frame copies them. While paused the memo
  // keeps the last copy, which leaves a still chart to zoom and inspect.
  const frameKey = isPaused ? null : sampleVersion;
  const live = useMemo(() => {
    const signals: Signal[] = [
      {
        ...CURRENT_LOOK,
        id: "current",
        label: "Corrente média",
        color: CHART_COLOR_CURRENT,
        data: [...buffers.current],
      },
      {
        ...CURRENT_LOOK,
        id: "currentPeak",
        label: "Corrente pico",
        color: CHART_COLOR_CURRENT_PEAK,
        data: [...buffers.currentPeak],
      },
      {
        ...CURRENT_LOOK,
        id: "currentMin",
        label: "Corrente mínima",
        color: CHART_COLOR_CURRENT_MIN,
        data: [...buffers.currentMin],
      },
      {
        id: "stick",
        label: "Stick",
        group: "Comando",
        unit: "%",
        scaleGroup: "stick",
        digits: 0,
        range: [0, 100],
        color: CHART_COLOR_STICK,
        data: [...buffers.stick],
      },
      {
        id: "voltage",
        label: "Tensão total",
        group: "Bateria",
        unit: "V",
        scaleGroup: "voltage",
        digits: 2,
        color: CHART_COLOR_VOLTAGE,
        data: [...buffers.voltage],
      },
      {
        id: "rssi",
        label: "RSSI",
        group: "Rádio",
        unit: "dBm",
        scaleGroup: "rssi",
        digits: 0,
        color: CHART_COLOR_RSSI,
        data: [...buffers.rssi],
      },
    ];
    return { x: [...buffers.times], signals };
  }, [frameKey, buffers]);

  // Tiles read the buffers, not the copy above, so they stay live while the chart is paused.
  const smoothedLast = (values: readonly number[], id: string) => {
    const window = selection.windowOf(id);
    return lastNumber(movingAverage(values.slice(-window), window));
  };

  const handleConnect = () => {
    if (!ipValid) return;
    connect();
  };

  const canCalibrate = isOnline && !isRecording && (lastSample?.stickPct ?? 0) === 0;

  const handleCalibrate = () => {
    sendCommand("CALIBRATE_ZERO");
    setIsConfirmingCalibration(false);
  };

  const handleSerialConnect = () => {
    connectSerial().catch((cause: unknown) => console.warn("Serial port not selected", cause));
  };

  return (
    <main className="nb-main">
      <div className="nb-content">
        <header className="nb-hero">
          <div>
            <div className="nb-hero__eyebrow">
              <span className="nb-hero__eyebrow-dot" aria-hidden />
              <span>Monitoramento em tempo real</span>
            </div>
            <h1 className="nb-hero__title">Telemetria ao Vivo</h1>
            <p className="nb-hero__lede">
              Acompanhe corrente, stick e tensão em tempo real, grave logs pela serial e no cartão
              SD ao mesmo tempo e ajuste o receptor.
            </p>
          </div>
          <div className="nb-hero__aside">
            <ConnectionStatusBadge status={status} linkLabel="WiFi" />
            <ConnectionStatusBadge status={serialStatus} linkLabel="Serial" />
          </div>
        </header>

        <div className="nb-grid nb-grid--2">
          <Card
            heading="Conexão WiFi"
            action={
              isWifiOnline || isWifiConnecting ? (
                <Button variant="danger" onClick={disconnect}>
                  Desconectar
                </Button>
              ) : (
                <Button variant="primary" onClick={handleConnect} disabled={!ipValid}>
                  Conectar
                </Button>
              )
            }
          >
            <div className="nt-connect">
              <Field
                label="IP do ESP32"
                inputMode="decimal"
                placeholder="192.168.4.1"
                value={config.ip}
                invalid={config.ip.length > 0 && !ipValid}
                hint={
                  config.ip.length > 0 && !ipValid ? "Endereço inválido" : "Access point do ESP32"
                }
                onChange={(event) => setConfig({ ip: event.target.value })}
              />
            </div>
          </Card>

          <Card
            heading="Conexão serial"
            action={
              isSerialOnline || isSerialConnecting ? (
                <Button variant="danger" onClick={() => void disconnectSerial()}>
                  Desconectar
                </Button>
              ) : (
                <Button
                  variant="primary"
                  onClick={handleSerialConnect}
                  disabled={!isSerialSupported()}
                >
                  Conectar
                </Button>
              )
            }
          >
            {isSerialSupported() ? (
              <div className="nt-connect">
                <div className="nb-field">
                  <span className="nb-field__label">Porta USB</span>
                  <output className="nt-port-state">{SERIAL_PORT_STATE[serialStatus]}</output>
                  <span className="nb-field__hint">Reconecta sozinho se o cabo cair</span>
                </div>
              </div>
            ) : (
              <Alert variant="warning">
                Este navegador não tem Web Serial. Use Chrome, Edge ou Chromium em localhost.
              </Alert>
            )}
          </Card>
        </div>

        <Section title="Leituras" eyebrow="Agora">
          <MetricRow>
            <MetricTile
              label="RSSI"
              value={lastSample ? intOrDash(lastSample.rssi) : "—"}
              unit="dBm"
              color={CHART_COLOR_RSSI}
            />
            <MetricTile
              label="Tensão"
              value={fixedOrDash(lastSample?.voltage ?? null, 2)}
              unit="V"
              color={CHART_COLOR_VOLTAGE}
            />
            <MetricTile
              label="Stick"
              value={intOrDash(smoothedLast(buffers.stick, "stick"))}
              unit="%"
              color={CHART_COLOR_STICK}
            />
            <MetricTile
              label="Corrente"
              value={fixedOrDash(smoothedLast(buffers.current, "current"), 1)}
              unit="A"
              color={CHART_COLOR_CURRENT}
            />
          </MetricRow>
        </Section>

        <Section title="Sinais ao vivo" eyebrow="Corrente · Stick · Tensão">
          <Card>
            <SignalExplorer
              x={live.x}
              signals={live.signals}
              selection={selection}
              defaults={LIVE_DEFAULTS}
              ariaLabel="Gráfico ao vivo dos sinais selecionados"
              formatX={formatClock}
              xSteps={SECOND_TICK_STEPS}
              visiblePoints={visibleWindow}
              live
              follow={!isPaused}
              onZoomChange={(isZoomed) => {
                if (isZoomed) setIsPaused(true);
              }}
              controls={
                <>
                  <label className="nt-ma-field">
                    Janela visível
                    <NumberInput
                      value={visibleWindow}
                      min={10}
                      max={2000}
                      aria-label="Janela visível em pontos"
                      onValueChange={setVisibleWindow}
                    />
                  </label>
                  <Button
                    variant="secondary"
                    aria-pressed={isPaused}
                    onClick={() => setIsPaused((paused) => !paused)}
                  >
                    {isPaused ? "▶ Voltar ao vivo" : "⏸ Pausar"}
                  </Button>
                </>
              }
            />
          </Card>
        </Section>

        <Section title="Controles" eyebrow="Gravação · Receptor">
          {!isOnline ? (
            <div style={{ marginBottom: 16 }}>
              <Alert variant="warning">
                Conecte ao ESP32 por WiFi ou serial para gravar logs e configurar o receptor.
              </Alert>
            </div>
          ) : null}
          <div className="nb-grid nt-controls">
            <Card heading="Gravação">
              <div className="nt-record">
                <div className="nt-record__status">
                  {isRecording ? (
                    <>
                      <span className="nt-rec-dot" aria-hidden />
                      <span>Gravando</span>
                    </>
                  ) : (
                    <span>
                      {recording?.phase === "stopped" ? "Gravação parada" : "Pronto para gravar"}
                    </span>
                  )}
                </div>
                {isRecording ? (
                  <dl className="nt-record__targets">
                    <dt>Serial</dt>
                    <dd>{formatSampleCount(browserRecording.samples)}</dd>
                    <dt>Cartão SD</dt>
                    <dd>
                      {isSdRecording ? (
                        <span className="nt-record__file">{recording?.file}</span>
                      ) : (
                        "sem gravação"
                      )}
                    </dd>
                  </dl>
                ) : null}
                {isRecording && !isSerialOnline ? (
                  <Alert variant="warning">
                    Sem serial conectada: nada está sendo salvo no navegador.
                  </Alert>
                ) : null}
                {sdFailed ? (
                  <Alert variant="warning">
                    Cartão SD falhou. A serial segue salvando no navegador.
                  </Alert>
                ) : null}
                {logStoreFailed ? (
                  <Alert variant="warning">
                    O navegador não conseguiu salvar no disco. Não feche a aba: os arquivos ainda
                    baixam ao parar a gravação.
                  </Alert>
                ) : null}
                <div className="nt-record__buttons">
                  <Button
                    variant="success"
                    disabled={!isOnline || isRecording}
                    onClick={startRecording}
                  >
                    Iniciar
                  </Button>
                  <Button
                    variant="danger"
                    disabled={!isRecording}
                    onClick={() => void stopRecording()}
                  >
                    Parar
                  </Button>
                </div>
                {downloadFile ? (
                  <Button
                    variant="secondary"
                    block
                    onClick={() =>
                      globalThis.open(
                        `http://${config.ip}/download?file=${downloadFile}`,
                        "_blank",
                        "noopener",
                      )
                    }
                  >
                    ⤓ Baixar do SD {downloadFile}
                  </Button>
                ) : null}
              </div>
            </Card>

            <Card heading="Receptor">
              <div className="nt-record">
                <div className="nt-record__status">
                  Modo atual: <strong>{recording?.rxMode ?? "—"}</strong>
                </div>
                <div className="nt-segmented" role="group" aria-label="Modo do receptor">
                  <button
                    type="button"
                    className={`nt-segmented__option${recording?.rxMode === "UNI" ? " is-active" : ""}`}
                    aria-pressed={recording?.rxMode === "UNI"}
                    disabled={!isOnline}
                    onClick={() => sendCommand("SET_RX_UNI")}
                  >
                    Unidirecional
                  </button>
                  <button
                    type="button"
                    className={`nt-segmented__option${recording?.rxMode === "BI" ? " is-active" : ""}`}
                    aria-pressed={recording?.rxMode === "BI"}
                    disabled={!isOnline}
                    onClick={() => sendCommand("SET_RX_BI")}
                  >
                    Bidirecional
                  </button>
                </div>
              </div>
            </Card>
            <Card heading="Sensor de corrente">
              <div className="nt-record">
                <div className="nt-record__status">
                  <span>
                    Zero atual: <strong>{fixedOrDash(recording?.currentZeroA ?? null, 3)} A</strong>
                    {calibratedAt
                      ? ` · calibrado às ${calibratedAt.toLocaleTimeString("pt-BR")}`
                      : null}
                  </span>
                </div>
                {isConfirmingCalibration ? (
                  <>
                    <Alert variant="warning">
                      Motor parado e sem corrente circulando? Com corrente, o zero salvo na placa
                      fica errado.
                    </Alert>
                    <div className="nt-record__buttons">
                      <Button variant="secondary" onClick={() => setIsConfirmingCalibration(false)}>
                        Cancelar
                      </Button>
                      <Button variant="primary" disabled={!canCalibrate} onClick={handleCalibrate}>
                        Calibrar agora
                      </Button>
                    </div>
                  </>
                ) : (
                  <Button
                    variant="secondary"
                    block
                    disabled={!canCalibrate}
                    onClick={() => setIsConfirmingCalibration(true)}
                  >
                    Calibrar zero
                  </Button>
                )}
              </div>
            </Card>
          </div>
        </Section>

        <Section title="Logs salvos" eyebrow="Serial">
          <Card>
            {savedLogs.length === 0 ? (
              <p className="nb-section__subtitle">
                Nenhum log salvo. O botão Iniciar grava um CSV da serial, que fica aqui até você
                excluir.
              </p>
            ) : (
              <ul className="nt-saved-logs">
                {savedLogs.map((log) => (
                  <li key={log.fileName} className="nt-saved-logs__row">
                    <span className="nt-record__file">{log.fileName}</span>
                    <span className="nb-section__subtitle">{formatKilobytes(log.characters)}</span>
                    <Button variant="secondary" onClick={() => void downloadSavedLog(log.fileName)}>
                      Baixar
                    </Button>
                    <Button
                      variant="ghost"
                      aria-label={`Excluir ${log.fileName}`}
                      onClick={() => void deleteSavedLog(log.fileName)}
                    >
                      Excluir
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </Section>

        <Section title="Células da bateria" eyebrow="Tensão por célula">
          <div className="nt-cells">
            {lastSample
              ? (Object.entries(lastSample.cells) as [string, number | null][]).map(
                  ([key, value]) => (
                    <div key={key} className="nt-cell" data-empty={value === null}>
                      <span className="nt-cell__label">{key.toUpperCase()}</span>
                      <span className="nt-cell__value">{fixedOrDash(value, 2)}</span>
                    </div>
                  ),
                )
              : (["C1", "C2", "C3", "C4", "C5", "C6"] as const).map((key) => (
                  <div key={key} className="nt-cell" data-empty="true">
                    <span className="nt-cell__label">{key}</span>
                    <span className="nt-cell__value">—</span>
                  </div>
                ))}
          </div>
        </Section>
      </div>
    </main>
  );
}
