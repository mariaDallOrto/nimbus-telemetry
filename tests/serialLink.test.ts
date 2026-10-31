import { describe, expect, mock, test } from "bun:test";
import { openSerialLink, splitLines } from "../src/telemetry/serialLink";

type FakePort = SerialPort & {
  pushText: (text: string) => void;
  unplug: () => void;
  written: () => string;
  openOptions: () => SerialOptions | null;
  signals: () => SerialOutputSignals | null;
};

function fakePort(): FakePort {
  const encoder = new TextEncoder();
  let controller: ReadableStreamDefaultController<Uint8Array> | null = null;
  let written = "";
  let openOptions: SerialOptions | null = null;
  let signals: SerialOutputSignals | null = null;
  const port = {
    readable: new ReadableStream<Uint8Array>({ start: (c) => void (controller = c) }),
    writable: {
      getWriter: () => ({
        write: async (chunk: Uint8Array) => void (written += new TextDecoder().decode(chunk)),
        releaseLock: () => {},
      }),
    },
    open: async (options: SerialOptions) => void (openOptions = options),
    setSignals: async (value: SerialOutputSignals) => void (signals = value),
    close: async () => undefined,
    pushText: (text: string) => controller?.enqueue(encoder.encode(text)),
    unplug: () => {
      port.readable = null;
      controller?.error(new Error("device lost"));
    },
    written: () => written,
    openOptions: () => openOptions,
    signals: () => signals,
  };
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- test double
  return port as unknown as FakePort;
}

describe("splitLines", () => {
  test("holds a partial line until its newline arrives", () => {
    const first = splitLines("", '{"a":1}\n{"b"');
    expect(first).toEqual({ lines: ['{"a":1}'], rest: '{"b"' });
    expect(splitLines(first.rest, ":2}\r\n")).toEqual({ lines: ['{"b":2}'], rest: "" });
  });

  test("drops blank lines", () => {
    expect(splitLines("", "\r\n\n").lines).toEqual([]);
  });
});

describe("openSerialLink", () => {
  test("opens at the firmware baud rate with reset lines released", async () => {
    const port = fakePort();
    const link = await openSerialLink(port, { onLine: () => {}, onLost: () => {} });
    expect(port.openOptions()?.baudRate).toBe(115200);
    expect(port.signals()).toEqual({ dataTerminalReady: false, requestToSend: false });
    await link.close();
  });

  test("delivers lines split across chunks", async () => {
    const port = fakePort();
    const lines: string[] = [];
    const link = await openSerialLink(port, { onLine: (l) => lines.push(l), onLost: () => {} });
    port.pushText("[INFO] bo");
    port.pushText('ot\n{"id":1}\n');
    await Bun.sleep(0);
    expect(lines).toEqual(["[INFO] boot", '{"id":1}']);
    await link.close();
  });

  test("terminates commands with a newline", async () => {
    const port = fakePort();
    const link = await openSerialLink(port, { onLine: () => {}, onLost: () => {} });
    await link.send("START_RECORD");
    expect(port.written()).toBe("\nSTART_RECORD\n");
    await link.close();
  });

  test("writes overlapping commands in order", async () => {
    const port = fakePort();
    const link = await openSerialLink(port, { onLine: () => {}, onLost: () => {} });
    await Promise.all([link.send("A"), link.send("B")]);
    expect(port.written()).toBe("\nA\n\nB\n");
    await link.close();
  });

  test("releases the port when the reset lines cannot be set", async () => {
    const port = fakePort();
    const closed = mock(async () => {});
    port.close = closed;
    port.setSignals = async () => {
      throw new Error("unsupported");
    };
    const opening = openSerialLink(port, { onLine: () => {}, onLost: () => {} });
    await expect(opening).rejects.toThrow("unsupported");
    expect(closed).toHaveBeenCalledTimes(1);
  });

  test("reports a pulled cable", async () => {
    const port = fakePort();
    const onLost = mock(() => {});
    await openSerialLink(port, { onLine: () => {}, onLost });
    port.unplug();
    await Bun.sleep(0);
    expect(onLost).toHaveBeenCalledTimes(1);
  });

  test("stays quiet on a requested close", async () => {
    const port = fakePort();
    const onLost = mock(() => {});
    const link = await openSerialLink(port, { onLine: () => {}, onLost });
    await link.close();
    expect(onLost).not.toHaveBeenCalled();
  });
});
