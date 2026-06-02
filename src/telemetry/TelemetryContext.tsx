import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { estimateRpm } from "./rpm";
import { parseTelemetryMessage } from "./parseMessage";
import type { ConnectionStatus, MotorConfig, RecordingStatus, TelemetrySample } from "./types";

const STORAGE_KEYS = {
  ip: "esp32_ip",
  kv: "motor_kv",
  resistance: "motor_r",
  reduction: "motor_reduction",
} as const;
const RECONNECT_DELAY_MS = 2000;
const MAX_SAMPLES = 2000;

/** Rolling, fixed-capacity buffers feeding the live chart. */
export type LiveBuffers = {
  labels: string[];
  stick: number[];
  current: number[];
  rpm: number[];
};

type TelemetryContextValue = {
  status: ConnectionStatus;
  config: MotorConfig;
  setConfig: (patch: Partial<MotorConfig>) => void;
  recording: RecordingStatus | null;
  lastSample: TelemetrySample | null;
  buffers: LiveBuffers;
  /** Increments on every sample so consumers can memoize chart derivations. */
  sampleVersion: number;
  connect: () => void;
  disconnect: () => void;
  sendCommand: (command: string) => void;
};

const TelemetryContext = createContext<TelemetryContextValue | null>(null);

function readNumber(key: string, fallback: number): number {
  const raw = globalThis.localStorage?.getItem(key);
  const parsed = raw === null || raw === undefined ? Number.NaN : Number.parseFloat(raw);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function readInitialConfig(): MotorConfig {
  if (typeof globalThis.localStorage === "undefined") {
    return { ip: "", kv: 100, resistance: 0.1, reduction: 1 };
  }
  return {
    ip: globalThis.localStorage.getItem(STORAGE_KEYS.ip) ?? "",
    kv: readNumber(STORAGE_KEYS.kv, 100),
    resistance: readNumber(STORAGE_KEYS.resistance, 0.1),
    reduction: readNumber(STORAGE_KEYS.reduction, 1),
  };
}

function emptyBuffers(): LiveBuffers {
  return { labels: [], stick: [], current: [], rpm: [] };
}

function pushCapped(buffer: number[], value: number): void {
  buffer.push(value);
  if (buffer.length > MAX_SAMPLES) buffer.shift();
}

export function TelemetryProvider({ children }: { children: ReactNode }) {
  const [config, setConfigState] = useState<MotorConfig>(readInitialConfig);
  const [status, setStatus] = useState<ConnectionStatus>("offline");
  const [recording, setRecording] = useState<RecordingStatus | null>(null);
  const [lastSample, setLastSample] = useState<TelemetrySample | null>(null);
  const [sampleVersion, setSampleVersion] = useState(0);

  const buffersRef = useRef<LiveBuffers>(emptyBuffers());
  const socketRef = useRef<WebSocket | null>(null);
  const reconnectRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const intentionalCloseRef = useRef(false);
  // Keep the latest config readable inside socket callbacks without
  // re-subscribing the WebSocket on every keystroke.
  const configRef = useRef(config);
  configRef.current = config;

  const setConfig = useCallback((patch: Partial<MotorConfig>) => {
    setConfigState((prev) => {
      const next = { ...prev, ...patch };
      const store = globalThis.localStorage;
      if (store) {
        store.setItem(STORAGE_KEYS.ip, next.ip);
        store.setItem(STORAGE_KEYS.kv, String(next.kv));
        store.setItem(STORAGE_KEYS.resistance, String(next.resistance));
        store.setItem(STORAGE_KEYS.reduction, String(next.reduction));
      }
      return next;
    });
  }, []);

  const handleSample = useCallback((sample: TelemetrySample) => {
    const buffers = buffersRef.current;
    const rpm = estimateRpm(sample, configRef.current);
    pushCapped(buffers.stick, sample.stickPct);
    pushCapped(buffers.current, sample.current);
    pushCapped(buffers.rpm, rpm);
    buffers.labels.push(new Date().toLocaleTimeString("pt-BR"));
    if (buffers.labels.length > MAX_SAMPLES) buffers.labels.shift();
    setLastSample(sample);
    setSampleVersion((version) => version + 1);
  }, []);

  const connect = useCallback(() => {
    const { ip } = configRef.current;
    if (!ip) return;
    if (socketRef.current && socketRef.current.readyState === WebSocket.OPEN) return;
    if (reconnectRef.current) clearTimeout(reconnectRef.current);
    intentionalCloseRef.current = false;
    socketRef.current?.close();

    setStatus((prev) => (prev === "reconnecting" ? prev : "connecting"));
    const socket = new WebSocket(`ws://${ip}/ws`);
    socketRef.current = socket;

    socket.onopen = () => setStatus("online");
    socket.onmessage = (event) => {
      const message = parseTelemetryMessage(String(event.data));
      if (!message) return;
      if (message.kind === "status") {
        setRecording(message.status);
        return;
      }
      handleSample(message.sample);
    };
    socket.onclose = () => {
      socketRef.current = null;
      if (intentionalCloseRef.current) {
        setStatus("offline");
        return;
      }
      setStatus("reconnecting");
      reconnectRef.current = setTimeout(() => connect(), RECONNECT_DELAY_MS);
    };
  }, [handleSample]);

  const disconnect = useCallback(() => {
    intentionalCloseRef.current = true;
    if (reconnectRef.current) clearTimeout(reconnectRef.current);
    socketRef.current?.close();
    socketRef.current = null;
    setStatus("offline");
  }, []);

  const sendCommand = useCallback((command: string) => {
    const socket = socketRef.current;
    if (socket && socket.readyState === WebSocket.OPEN) socket.send(command);
  }, []);

  useEffect(() => {
    return () => {
      intentionalCloseRef.current = true;
      if (reconnectRef.current) clearTimeout(reconnectRef.current);
      socketRef.current?.close();
    };
  }, []);

  const value = useMemo<TelemetryContextValue>(
    () => ({
      status,
      config,
      setConfig,
      recording,
      lastSample,
      buffers: buffersRef.current,
      sampleVersion,
      connect,
      disconnect,
      sendCommand,
    }),
    [
      status,
      config,
      setConfig,
      recording,
      lastSample,
      sampleVersion,
      connect,
      disconnect,
      sendCommand,
    ],
  );

  return <TelemetryContext.Provider value={value}>{children}</TelemetryContext.Provider>;
}

export function useTelemetry(): TelemetryContextValue {
  const ctx = useContext(TelemetryContext);
  if (!ctx) throw new Error("useTelemetry must be used within a TelemetryProvider");
  return ctx;
}
