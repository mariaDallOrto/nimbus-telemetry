import "fake-indexeddb/auto";
import { describe, expect, test } from "bun:test";
import { createLogStore } from "../src/telemetry/logStore";

describe("logStore", () => {
  test("rebuilds a file from chunks in write order", async () => {
    const store = createLogStore();
    await store.append("order.csv", "a\n");
    await store.append("other.csv", "x\n");
    await store.append("order.csv", "b\n");
    expect(await store.read("order.csv")).toBe("a\nb\n");
  });

  test("keeps files available to a new session", async () => {
    await createLogStore().append("reload.csv", "row\n");
    const logs = await createLogStore().list();
    expect(logs).toContainEqual({ fileName: "reload.csv", characters: 4 });
  });

  test("removes every chunk of a file", async () => {
    const store = createLogStore();
    await store.append("gone.csv", "a");
    await store.append("gone.csv", "b");
    await store.remove("gone.csv");
    expect(await store.read("gone.csv")).toBe("");
  });

  test("recovers after the browser closes the connection", async () => {
    const store = createLogStore();
    await store.append("closed.csv", "a");
    const databases = await indexedDB.databases();
    const open = indexedDB.open(databases[0]?.name ?? "");
    await new Promise((resolve) => (open.onsuccess = resolve));
    open.result.close();
    await store.append("closed.csv", "b");
    expect(await store.read("closed.csv")).toBe("ab");
  });
});
