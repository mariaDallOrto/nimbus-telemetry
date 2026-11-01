import { describe, expect, test } from "bun:test";
import { anchorStyle, dragStep, movedAnchor } from "../src/charts/useDraggableAnchor";

describe("draggable anchor", () => {
  test("moves inside the free space", () => {
    expect(movedAnchor({ x: 0.5, y: 0.5 }, { x: 0.25, y: -0.25 })).toEqual({ x: 0.75, y: 0.25 });
  });

  test("stops at the edges", () => {
    expect(movedAnchor({ x: 0.9, y: 0.1 }, { x: 1, y: -1 })).toEqual({ x: 1, y: 0 });
  });

  test("scales a drag by the free space", () => {
    expect(dragStep(50, 200)).toBe(0.25);
  });

  test("ignores a drag when nothing is free to move into", () => {
    expect(dragStep(50, 0)).toBe(0);
    expect(dragStep(50, -30)).toBe(0);
  });

  test("offsets by its own size so the far edge stays inside", () => {
    expect(anchorStyle({ x: 1, y: 0.5 }).transform).toBe("translate(-100%, -50%)");
  });
});
