import { describe, expect, test } from "bun:test";
import { fuzzyScore } from "../src/ui/fuzzyScore";

describe("fuzzyScore", () => {
  test("matches letters in order with gaps", () => {
    expect(fuzzyScore("crtmed", "Corrente média")).not.toBeNull();
  });

  test("ignores accents and case", () => {
    expect(fuzzyScore("TENSAO", "Tensão total")).not.toBeNull();
  });

  test("ignores spaces in the query", () => {
    expect(fuzzyScore("tensao total", "Tensão total")).not.toBeNull();
  });

  test("rejects letters out of order", () => {
    expect(fuzzyScore("ipco", "pico")).toBeNull();
  });

  test("ranks a word start above letters buried in a word", () => {
    const wordStart = fuzzyScore("pi", "Corrente pico") ?? 0;
    const buried = fuzzyScore("pi", "Tempo dispi") ?? 0;
    expect(wordStart).toBeGreaterThan(buried);
  });
});
