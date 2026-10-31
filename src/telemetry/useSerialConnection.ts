import { useCallback, useEffect, useRef, useState } from "react";
import { openSerialLink, type SerialLink } from "./serialLink";
import type { ConnectionStatus } from "./types";

const RECONNECT_DELAY_MS = 2000;

async function findGrantedPort(previous: SerialPort): Promise<SerialPort> {
  const ports = await navigator.serial.getPorts();
  if (ports.includes(previous)) return previous;
  const { usbVendorId, usbProductId } = previous.getInfo();
  const isSameAdapter = (port: SerialPort) => {
    const info = port.getInfo();
    return info.usbVendorId === usbVendorId && info.usbProductId === usbProductId;
  };
  return ports.find(isSameAdapter) ?? previous;
}

export function useSerialConnection(onLine: (line: string) => void, onLost: () => void) {
  const [status, setStatus] = useState<ConnectionStatus>("offline");
  const linkRef = useRef<SerialLink | null>(null);
  const reconnectRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const attemptRef = useRef(0);
  const callbacksRef = useRef({ onLine, onLost });
  callbacksRef.current = { onLine, onLost };

  const openPort = useCallback(async (port: SerialPort) => {
    attemptRef.current += 1;
    const attempt = attemptRef.current;
    const isStale = () => attempt !== attemptRef.current;

    const scheduleReconnect = () => {
      if (isStale()) return;
      if (reconnectRef.current) clearTimeout(reconnectRef.current);
      setStatus("reconnecting");
      reconnectRef.current = setTimeout(async () => {
        const granted = await findGrantedPort(port).catch(() => port);
        if (!isStale()) void openPort(granted);
      }, RECONNECT_DELAY_MS);
    };

    let link: SerialLink;
    try {
      link = await openSerialLink(port, {
        onLine: (line) => callbacksRef.current.onLine(line),
        onLost: () => {
          linkRef.current = null;
          callbacksRef.current.onLost();
          scheduleReconnect();
        },
      });
    } catch (cause) {
      console.warn("Serial open failed", cause);
      scheduleReconnect();
      return;
    }
    if (isStale()) {
      await link.close();
      return;
    }
    linkRef.current = link;
    setStatus("online");
    link.send("GET_STATUS").catch((cause: unknown) => {
      console.warn("Serial status request failed", cause);
    });
  }, []);

  const connect = useCallback(async () => {
    const port = await navigator.serial.requestPort();
    setStatus("connecting");
    await openPort(port);
  }, [openPort]);

  const disconnect = useCallback(async () => {
    attemptRef.current += 1;
    if (reconnectRef.current) clearTimeout(reconnectRef.current);
    await linkRef.current?.close();
    linkRef.current = null;
    setStatus("offline");
  }, []);

  const send = useCallback((command: string) => {
    linkRef.current?.send(command).catch((cause: unknown) => {
      console.warn("Serial send failed", cause);
    });
  }, []);

  useEffect(() => {
    return () => {
      attemptRef.current += 1;
      if (reconnectRef.current) clearTimeout(reconnectRef.current);
      void linkRef.current?.close();
    };
  }, []);

  return { status, connect, disconnect, send };
}
