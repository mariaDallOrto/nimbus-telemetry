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
import { createLogStore, type SavedLog } from "./logStore";
import { estimateRpm } from "./rpm";
import { parseTelemetryMessage } from "./parseMessage";
import { createSessionRecorder } from "./sessionRecorder";
import { useSerialConnection } from "./useSerialConnection";
import type {
  ConnectionStatus,
  MotorConfig,
  RecordingStatus,
  TelemetryLink,
  TelemetrySample,
} from "./types";

const STORAGE_KEYS = {
  ip: "esp32_ip",
  kv: "motor_kv",
  resistance: "motor_r",
  reduction: "motor_reduction",
} as const;
const RECONNECT_DELAY_MS = 2000;
const MAX_SAMPLES = 2000;
/** WiFi feeds the live view only after Serial stays silent this long. */
const SERIAL_LIVE_WINDOW_MS = 500;

/** Rolling, fixed-capacity buffers feeding the live chart. */
export type LiveBuffers = {
  labels: string[];
  stick: number[];
  current: number[];
  currentPeak: number[];
  rpm: number[];
};

export type BrowserRecording = {
  isActive: boolean;
  samples: number;
};

type TelemetryContextValue = {
  status: ConnectionStatus;
  serialStatus: ConnectionStatus;
  config: MotorConfig;
  setConfig: (patch: Partial<MotorConfig>) => void;
  recording: RecordingStatus | null;
  lastSample: TelemetrySample | null;
  buffers: LiveBuffers;
  /** Increments on every sample so consumers can memoize chart derivations. */
  sampleVersion: number;
  connect: () => void;
  disconnect: () => void;
  connectSerial: () => Promise<void>;
  disconnectSerial: () => Promise<void>;
  sendCommand: (command: string) => void;
  browserRecording: BrowserRecording;
  startRecording: () => void;
  stopRecording: () => Promise<void>;
  savedLogs: SavedLog[];
  downloadSavedLog: (fileName: string) => Promise<void>;
  deleteSavedLog: (fileName: string) => Promise<void>;
  logStoreFailed: boolean;
  /** Moment the board last confirmed a zero calibration in this session. */
  calibratedAt: Date | null;
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
  return { labels: [], stick: [], current: [], currentPeak: [], rpm: [] };
}

function pushCapped(buffer: number[], value: number): void {
  buffer.push(value);
  if (buffer.length > MAX_SAMPLES) buffer.shift();
}

function downloadTextFile(fileName: string, text: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: "text/csv" }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
  URL.revokeObjectURL(url);
}

const logStore = createLogStore();

export function TelemetryProvider({ children }: { children: ReactNode }) {
  const [config, setConfigState] = useState<MotorConfig>(readInitialConfig);
  const [status, setStatus] = useState<ConnectionStatus>("offline");
  const [recording, setRecording] = useState<RecordingStatus | null>(null);
  const [lastSample, setLastSample] = useState<TelemetrySample | null>(null);
  const [sampleVersion, setSampleVersion] = useState(0);
  const [savedLogs, setSavedLogs] = useState<SavedLog[]>([]);
  const [isBrowserRecording, setIsBrowserRecording] = useState(false);
  const [logStoreFailed, setLogStoreFailed] = useState(false);
  const [calibratedAt, setCalibratedAt] = useState<Date | null>(null);

  const buffersRef = useRef<LiveBuffers>(emptyBuffers());
  const socketRef = useRef<WebSocket | null>(null);
  const reconnectRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const intentionalCloseRef = useRef(false);
  const lastSerialSampleAtRef = useRef(0);
  const [recorder] = useState(() =>
    createSessionRecorder(logStore, (cause) => {
      console.error("Log store write failed", cause);
      setLogStoreFailed(true);
    }),
  );
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

  const showSample = useCallback((sample: TelemetrySample) => {
    const buffers = buffersRef.current;
    const rpm = estimateRpm(sample, configRef.current);
    pushCapped(buffers.stick, sample.stickPct);
    pushCapped(buffers.current, sample.current);
    pushCapped(buffers.currentPeak, sample.currentPeak ?? sample.current);
    pushCapped(buffers.rpm, rpm);
    buffers.labels.push(new Date().toLocaleTimeString("pt-BR"));
    if (buffers.labels.length > MAX_SAMPLES) buffers.labels.shift();
    setLastSample(sample);
    setSampleVersion((version) => version + 1);
  }, []);

  const handleFrame = useCallback(
    (link: TelemetryLink, raw: string) => {
      const message = parseTelemetryMessage(raw);
      if (!message) return;
      if (message.kind === "status") {
        setRecording(message.status);
        return;
      }
      if (message.kind === "calibrated") {
        setCalibratedAt(new Date());
        return;
      }
      const receivedAt = new Date();
      if (link === "serial") {
        recorder.record(message.sample, receivedAt);
        lastSerialSampleAtRef.current = receivedAt.getTime();
      }
      const serialIsLive =
        receivedAt.getTime() - lastSerialSampleAtRef.current < SERIAL_LIVE_WINDOW_MS;
      if (link === "serial" || !serialIsLive) showSample(message.sample);
    },
    [recorder, showSample],
  );

  const serial = useSerialConnection(
    (line) => handleFrame("serial", line),
    () => recorder.flush(),
  );
  const sendSerialCommand = serial.send;

  const refreshSavedLogs = useCallback(async () => {
    try {
      setSavedLogs(await logStore.list());
    } catch (cause) {
      console.error("Log store read failed", cause);
      setLogStoreFailed(true);
    }
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
      if (socketRef.current === socket) handleFrame("wifi", String(event.data));
    };
    socket.onclose = () => {
      if (socketRef.current !== socket) return;
      socketRef.current = null;
      if (intentionalCloseRef.current) {
        setStatus("offline");
        return;
      }
      setStatus("reconnecting");
      reconnectRef.current = setTimeout(() => connect(), RECONNECT_DELAY_MS);
    };
  }, [handleFrame]);

  const disconnect = useCallback(() => {
    intentionalCloseRef.current = true;
    if (reconnectRef.current) clearTimeout(reconnectRef.current);
    socketRef.current?.close();
    socketRef.current = null;
    setStatus("offline");
  }, []);

  const sendCommand = useCallback(
    (command: string) => {
      const socket = socketRef.current;
      // Both links: a half-open socket still reports OPEN, and the firmware ignores repeats.
      if (socket && socket.readyState === WebSocket.OPEN) socket.send(command);
      sendSerialCommand(command);
    },
    [sendSerialCommand],
  );

  const startRecording = useCallback(() => {
    recorder.start(new Date());
    setIsBrowserRecording(true);
    sendCommand("START_RECORD");
  }, [recorder, sendCommand]);

  const stopRecording = useCallback(async () => {
    sendCommand("STOP_RECORD");
    const file = await recorder.stop();
    setIsBrowserRecording(false);
    if (file) downloadTextFile(file.fileName, file.text);
    await refreshSavedLogs();
  }, [recorder, refreshSavedLogs, sendCommand]);

  const downloadSavedLog = useCallback(async (fileName: string) => {
    downloadTextFile(fileName, await logStore.read(fileName));
  }, []);

  const deleteSavedLog = useCallback(
    async (fileName: string) => {
      await logStore.remove(fileName);
      await refreshSavedLogs();
    },
    [refreshSavedLogs],
  );

  useEffect(() => {
    void refreshSavedLogs();
  }, [refreshSavedLogs]);

  useEffect(() => {
    if (!isBrowserRecording) return;
    const warnBeforeLeaving = (event: BeforeUnloadEvent) => event.preventDefault();
    globalThis.addEventListener("beforeunload", warnBeforeLeaving);
    return () => globalThis.removeEventListener("beforeunload", warnBeforeLeaving);
  }, [isBrowserRecording]);

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
      serialStatus: serial.status,
      config,
      setConfig,
      recording,
      lastSample,
      buffers: buffersRef.current,
      sampleVersion,
      connect,
      disconnect,
      connectSerial: serial.connect,
      disconnectSerial: serial.disconnect,
      sendCommand,
      browserRecording: {
        isActive: isBrowserRecording,
        samples: recorder.sampleCount(),
      },
      startRecording,
      stopRecording,
      savedLogs,
      downloadSavedLog,
      deleteSavedLog,
      logStoreFailed,
      calibratedAt,
    }),
    [
      status,
      serial.status,
      serial.connect,
      serial.disconnect,
      config,
      setConfig,
      recording,
      lastSample,
      sampleVersion,
      connect,
      disconnect,
      sendCommand,
      recorder,
      isBrowserRecording,
      startRecording,
      stopRecording,
      savedLogs,
      downloadSavedLog,
      deleteSavedLog,
      logStoreFailed,
      calibratedAt,
    ],
  );

  return <TelemetryContext.Provider value={value}>{children}</TelemetryContext.Provider>;
}

export function useTelemetry(): TelemetryContextValue {
  const ctx = useContext(TelemetryContext);
  if (!ctx) throw new Error("useTelemetry must be used within a TelemetryProvider");
  return ctx;
}
