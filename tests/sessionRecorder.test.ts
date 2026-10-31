import { describe, expect, test } from "bun:test";
import type { LogStore } from "../src/telemetry/logStore";
import { parseTelemetryMessage } from "../src/telemetry/parseMessage";
import { createSessionRecorder } from "../src/telemetry/sessionRecorder";

const START = new Date(2026, 9, 24, 14, 0, 0);

function secondsAfterStart(seconds: number) {
  return new Date(START.getTime() + seconds * 1000);
}

function sample() {
  const message = parseTelemetryMessage('{"id":1,"pwmVal":0,"vTotal":16,"current":1}');
  if (message?.kind !== "sample") throw new Error("expected sample");
  return message.sample;
}

function memoryStore() {
  const files = new Map<string, string>();
  const store: LogStore = {
    append: async (fileName, text) => void files.set(fileName, (files.get(fileName) ?? "") + text),
    read: async (fileName) => files.get(fileName) ?? "",
    list: async () => [],
    remove: async (fileName) => void files.delete(fileName),
  };
  return { files, store };
}

function dataRows(text: string) {
  return text.trim().split("\n").length - 1;
}

describe("sessionRecorder", () => {
  test("writes one file per link", async () => {
    const { files, store } = memoryStore();
    const recorder = createSessionRecorder(store, () => {});
    recorder.start(START);
    recorder.record("wifi", sample(), START);
    recorder.record("serial", sample(), START);
    recorder.record("serial", sample(), START);
    const recorded = await recorder.stop();

    expect(recorded.map((file) => file.fileName).sort()).toEqual([
      "2026-10-24T14_00_00_0-serial.csv",
      "2026-10-24T14_00_00_0-wifi.csv",
    ]);
    expect(dataRows(files.get("2026-10-24T14_00_00_0-serial.csv") ?? "")).toBe(2);
    expect(dataRows(files.get("2026-10-24T14_00_00_0-wifi.csv") ?? "")).toBe(1);
  });

  test("keeps a quick restart in its own files", async () => {
    const recorder = createSessionRecorder(memoryStore().store, () => {});
    recorder.start(START);
    recorder.record("wifi", sample(), START);
    const [first] = await recorder.stop();
    recorder.start(new Date(START.getTime() + 300));
    recorder.record("wifi", sample(), START);
    const [second] = await recorder.stop();
    expect(first?.fileName).not.toBe(second?.fileName);
  });

  test("stores nothing for a link that drops before its first sample", async () => {
    const { files, store } = memoryStore();
    const recorder = createSessionRecorder(store, () => {});
    recorder.start(START);
    recorder.flushLink("wifi");
    await recorder.stop();
    expect(files.size).toBe(0);
  });

  test("skips the file of a link that delivered nothing", async () => {
    const recorder = createSessionRecorder(memoryStore().store, () => {});
    recorder.start(START);
    recorder.record("serial", sample(), START);
    const recorded = await recorder.stop();
    expect(recorded.map((file) => file.fileName)).toEqual(["2026-10-24T14_00_00_0-serial.csv"]);
  });

  test("stores samples during the session, before stop", async () => {
    const { files, store } = memoryStore();
    const recorder = createSessionRecorder(store, () => {});
    recorder.start(START);
    recorder.record("wifi", sample(), secondsAfterStart(2));
    await Bun.sleep(0);
    expect(dataRows(files.get("2026-10-24T14_00_00_0-wifi.csv") ?? "")).toBe(1);
  });

  test("retries rows a failed write left behind, without duplicates", async () => {
    const { files, store } = memoryStore();
    let failNextWrite = true;
    const failures: unknown[] = [];
    const flakyStore: LogStore = {
      ...store,
      append: async (fileName, text) => {
        if (failNextWrite) {
          failNextWrite = false;
          throw new Error("quota");
        }
        await store.append(fileName, text);
      },
    };
    const recorder = createSessionRecorder(flakyStore, (cause) => failures.push(cause));
    recorder.start(START);
    recorder.record("wifi", sample(), secondsAfterStart(2));
    await Bun.sleep(0);
    recorder.record("wifi", sample(), secondsAfterStart(4));
    await recorder.stop();

    expect(failures).toHaveLength(1);
    expect(dataRows(files.get("2026-10-24T14_00_00_0-wifi.csv") ?? "")).toBe(2);
  });

  test("hands back the full file even when the store stays down", async () => {
    const { store } = memoryStore();
    const brokenStore: LogStore = {
      ...store,
      append: async () => {
        throw new Error("quota");
      },
    };
    const recorder = createSessionRecorder(brokenStore, () => {});
    recorder.start(START);
    recorder.record("wifi", sample(), START);
    const [file] = await recorder.stop();
    expect(dataRows(file?.text ?? "")).toBe(1);
  });
});
