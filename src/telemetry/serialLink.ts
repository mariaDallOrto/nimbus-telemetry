const SERIAL_BAUD = 115200;
const READ_BUFFER_BYTES = 65536;

type SerialLinkOptions = {
  onLine: (line: string) => void;
  /** Fires when the port dies on its own (cable pulled), not on `close()`. */
  onLost: () => void;
};

export type SerialLink = {
  send: (command: string) => Promise<void>;
  close: () => Promise<void>;
};

export function isSerialSupported(): boolean {
  return "serial" in navigator;
}

export function splitLines(buffered: string, chunk: string): { lines: string[]; rest: string } {
  const parts = `${buffered}${chunk}`.split("\n");
  const rest = parts.pop() ?? "";
  return { lines: parts.map((part) => part.trim()).filter(Boolean), rest };
}

export async function openSerialLink(
  port: SerialPort,
  { onLine, onLost }: SerialLinkOptions,
): Promise<SerialLink> {
  await port.open({ baudRate: SERIAL_BAUD, bufferSize: READ_BUFFER_BYTES });
  // DTR/RTS drive the DevKit auto-reset circuit: keep them released so opening
  // the port does not reboot the ESP32 in the middle of a run.
  try {
    await port.setSignals({ dataTerminalReady: false, requestToSend: false });
  } catch (cause) {
    await port.close();
    throw cause;
  }

  let closing = false;
  let activeReader: ReadableStreamDefaultReader<Uint8Array> | null = null;
  let sendQueue: Promise<void> = Promise.resolve();

  const readUntilClosed = async () => {
    const decoder = new TextDecoder();
    let rest = "";
    while (port.readable && !closing) {
      activeReader = port.readable.getReader();
      try {
        for (;;) {
          const { value, done } = await activeReader.read();
          if (done) break;
          const split = splitLines(rest, decoder.decode(value, { stream: true }));
          rest = split.rest;
          split.lines.forEach(onLine);
        }
      } catch (cause) {
        // Buffer overruns and framing errors land here; the outer loop resumes
        // on a fresh stream. An unplugged cable nulls `port.readable` instead.
        console.warn("Serial read error", cause);
      } finally {
        activeReader.releaseLock();
        activeReader = null;
      }
    }
    await port.close().catch((cause: unknown) => console.warn("Serial close error", cause));
    if (!closing) onLost();
  };
  const finished = readUntilClosed();

  return {
    send(command) {
      const write = async () => {
        if (!port.writable) return;
        const writer = port.writable.getWriter();
        try {
          // The leading newline discards any stray byte the firmware parser holds.
          await writer.write(new TextEncoder().encode(`\n${command}\n`));
        } finally {
          writer.releaseLock();
        }
      };
      sendQueue = sendQueue.then(write, write);
      return sendQueue;
    },
    async close() {
      closing = true;
      await activeReader?.cancel();
      await finished;
    },
  };
}
