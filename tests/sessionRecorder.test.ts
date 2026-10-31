import { describe, expect, test } from "bun:test";
import type { LogStore } from "../src/telemetry/logStore";
import { parseTelemetryMessage } from "../src/telemetry/parseMessage";
import { createSessionRecorder } from "../src/telemetry/sessionRecorder";

const START = new Date(2026, 9, 24, 14, 0, 0);
const FILE_NAME = "2026-10-24T14_00_00_0-serial.csv";

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
  test("writes the session to one serial file", async () => {
    const { files, store } = memoryStore();
    const recorder = createSessionRecorder(store, () => {});
    recorder.start(START);
    recorder.record(sample(), START);
    recorder.record(sample(), START);
    const recorded = await recorder.stop();

    expect(recorded?.fileName).toBe(FILE_NAME);
    expect(dataRows(files.get(FILE_NAME) ?? "")).toBe(2);
  });

  test("keeps a quick restart in its own file", async () => {
    const recorder = createSessionRecorder(memoryStore().store, () => {});
    recorder.start(START);
    recorder.record(sample(), START);
    const first = await recorder.stop();
    recorder.start(new Date(START.getTime() + 300));
    recorder.record(sample(), START);
    const second = await recorder.stop();
    expect(first?.fileName).not.toBe(second?.fileName);
  });

  test("produces no file when no sample arrived", async () => {
    const { files, store } = memoryStore();
    const recorder = createSessionRecorder(store, () => {});
    recorder.start(START);
    recorder.flush();
    expect(await recorder.stop()).toBeNull();
    expect(files.size).toBe(0);
  });

  test("stores samples during the session, before stop", async () => {
    const { files, store } = memoryStore();
    const recorder = createSessionRecorder(store, () => {});
    recorder.start(START);
    recorder.record(sample(), secondsAfterStart(2));
    await Bun.sleep(0);
    expect(dataRows(files.get(FILE_NAME) ?? "")).toBe(1);
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
    recorder.record(sample(), secondsAfterStart(2));
    await Bun.sleep(0);
    recorder.record(sample(), secondsAfterStart(4));
    await recorder.stop();

    expect(failures).toHaveLength(1);
    expect(dataRows(files.get(FILE_NAME) ?? "")).toBe(2);
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
    recorder.record(sample(), START);
    const file = await recorder.stop();
    expect(dataRows(file?.text ?? "")).toBe(1);
  });
});
