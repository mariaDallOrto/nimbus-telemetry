import { useMemo, useRef, useState } from "react";
import { Alert } from "../components/Alert";
import { Button } from "../components/Button";
import { Card } from "../components/Card";
import { ConnectionStatusBadge } from "../components/ConnectionStatusBadge";
import { Field } from "../components/Field";
import { MetricRow, MetricTile } from "../components/MetricTile";
import { NumberField } from "../components/NumberField";
import { NumberInput } from "../components/NumberInput";
import { Section } from "../components/Section";
import { ComboChart } from "../charts/ComboChart";
import {
  CHART_COLOR_CURRENT,
  CHART_COLOR_RPM,
  CHART_COLOR_RSSI,
  CHART_COLOR_STICK,
  CHART_COLOR_VOLTAGE,
} from "../charts/chartColors";
import { stickyBounds, type AxisBounds } from "../telemetry/axis";
import { movingAverage } from "../telemetry/movingAverage";
import { useTelemetry } from "../telemetry/TelemetryContext";
import { fixedOrDash, intOrDash, lastNumber, tail } from "../ui/format";

const SD_ERROR_MARKER = "ERRO_SD";

function isValidHost(ip: string): boolean {
  const trimmed = ip.trim();
  return trimmed.length > 0 && !/\s/.test(trimmed);
}

export default function LivePage() {
  const {
    status,
    config,
    setConfig,
    recording,
    lastSample,
    buffers,
    sampleVersion,
    connect,
    disconnect,
    sendCommand,
  } = useTelemetry();

  const [maStick, setMaStick] = useState(1);
  const [maCurrent, setMaCurrent] = useState(1);
  const [maRpm, setMaRpm] = useState(1);
  const [visibleWindow, setVisibleWindow] = useState(80);

  const currentBoundsRef = useRef<AxisBounds | null>(null);
  const rpmBoundsRef = useRef<AxisBounds | null>(null);

  const isOnline = status === "online";
  const isConnecting = status === "connecting" || status === "reconnecting";
  const ipValid = isValidHost(config.ip);
  const isRecording = recording?.phase === "started";
  const downloadFile =
    recording?.phase === "stopped" && recording.file && recording.file !== SD_ERROR_MARKER
      ? recording.file
      : null;

  // Derived chart series: slice to the visible window, then smooth each line.
  // Sticky axis bounds are kept in refs so they grow on demand and only shrink
  // with hysteresis (calm axes under noise). sampleVersion drives recompute.
  const chart = useMemo(() => {
    const labels = tail(buffers.labels, visibleWindow);
    const stick = movingAverage(tail(buffers.stick, visibleWindow), maStick);
    const current = movingAverage(tail(buffers.current, visibleWindow), maCurrent);
    const rpm = movingAverage(tail(buffers.rpm, visibleWindow), maRpm);
    currentBoundsRef.current = stickyBounds(currentBoundsRef.current, current);
    rpmBoundsRef.current = stickyBounds(rpmBoundsRef.current, rpm);
    return {
      labels,
      stick,
      current,
      rpm,
      lastStick: lastNumber(stick),
      lastCurrent: lastNumber(current),
      lastRpm: lastNumber(rpm),
    };
    // buffers mutate in place; sampleVersion is the change signal that drives recompute
  }, [sampleVersion, visibleWindow, maStick, maCurrent, maRpm, buffers]);

  const handleConnect = () => {
    if (!ipValid) return;
    connect();
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
              Acompanhe stick, corrente e RPM estimado em tempo real, grave logs no cartão SD e
              ajuste o receptor — tudo pela conexão WebSocket com o ESP32.
            </p>
          </div>
          <div className="nb-hero__aside">
            <ConnectionStatusBadge status={status} />
          </div>
        </header>

        <Card
          heading="Conexão"
          action={
            isOnline || isConnecting ? (
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
            <NumberField
              label="KV do motor"
              value={config.kv}
              min={0}
              placeholder="100"
              hint="rpm / volt"
              onValueChange={(kv) => setConfig({ kv })}
            />
            <NumberField
              label="Resistência"
              value={config.resistance}
              min={0}
              placeholder="0.10"
              hint="ohms (Ω)"
              onValueChange={(resistance) => setConfig({ resistance })}
            />
          </div>
        </Card>

        <Section title="Leituras" eyebrow="Agora">
          <MetricRow>
            <MetricTile
              label="RSSI"
              value={lastSample ? intOrDash(lastSample.rssi) : "—"}
              unit="dBm"
              color={CHART_COLOR_RSSI}
            />
            <MetricTile label="RPM Est." value={intOrDash(chart.lastRpm)} color={CHART_COLOR_RPM} />
            <MetricTile
              label="Tensão"
              value={fixedOrDash(lastSample?.voltage ?? null, 2)}
              unit="V"
              color={CHART_COLOR_VOLTAGE}
            />
            <MetricTile
              label="Stick"
              value={intOrDash(chart.lastStick)}
              unit="%"
              color={CHART_COLOR_STICK}
            />
            <MetricTile
              label="Corrente"
              value={fixedOrDash(chart.lastCurrent, 1)}
              unit="A"
              color={CHART_COLOR_CURRENT}
            />
          </MetricRow>
        </Section>

        <Section title="Sinais ao vivo" eyebrow="Stick · Corrente · RPM">
          <Card bodyPadding={false}>
            <div style={{ padding: "18px 18px 4px" }}>
              <ComboChart
                labels={chart.labels}
                stick={chart.stick}
                current={chart.current}
                rpm={chart.rpm}
                currentBounds={currentBoundsRef.current}
                rpmBounds={rpmBoundsRef.current}
              />
            </div>
            <div className="nt-toolbar">
              <span className="nt-toolbar__label">Média móvel (pontos)</span>
              <label className="nt-ma-field">
                <span
                  className="nt-ma-field__dot"
                  style={{ background: CHART_COLOR_STICK }}
                  aria-hidden
                />
                Stick
                <NumberInput
                  value={maStick}
                  min={1}
                  max={500}
                  aria-label="Média móvel do stick"
                  onValueChange={setMaStick}
                />
              </label>
              <label className="nt-ma-field">
                <span
                  className="nt-ma-field__dot"
                  style={{ background: CHART_COLOR_CURRENT }}
                  aria-hidden
                />
                Corrente
                <NumberInput
                  value={maCurrent}
                  min={1}
                  max={500}
                  aria-label="Média móvel da corrente"
                  onValueChange={setMaCurrent}
                />
              </label>
              <label className="nt-ma-field">
                <span
                  className="nt-ma-field__dot"
                  style={{ background: CHART_COLOR_RPM }}
                  aria-hidden
                />
                RPM
                <NumberInput
                  value={maRpm}
                  min={1}
                  max={500}
                  aria-label="Média móvel do RPM"
                  onValueChange={setMaRpm}
                />
              </label>
              <span className="nt-toolbar__divider" aria-hidden />
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
            </div>
          </Card>
        </Section>

        <Section title="Controles" eyebrow="Gravação · Receptor">
          {!isOnline ? (
            <div style={{ marginBottom: 16 }}>
              <Alert variant="warning">
                Conecte ao ESP32 para gravar logs e configurar o receptor.
              </Alert>
            </div>
          ) : null}
          <div className="nb-grid nb-grid--2">
            <Card heading="Gravação (SD)">
              <div className="nt-record">
                <div className="nt-record__status">
                  {isRecording ? (
                    <>
                      <span className="nt-rec-dot" aria-hidden />
                      <span>
                        Gravando · <span className="nt-record__file">{recording?.file}</span>
                      </span>
                    </>
                  ) : (
                    <span>
                      {recording?.phase === "stopped" ? "Gravação parada" : "Pronto para gravar"}
                    </span>
                  )}
                </div>
                <div className="nt-record__buttons">
                  <Button
                    variant="success"
                    disabled={!isOnline || isRecording}
                    onClick={() => sendCommand("START_RECORD")}
                  >
                    Iniciar
                  </Button>
                  <Button
                    variant="danger"
                    disabled={!isOnline || !isRecording}
                    onClick={() => sendCommand("STOP_RECORD")}
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
                    ⤓ Baixar {downloadFile}
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
          </div>
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
