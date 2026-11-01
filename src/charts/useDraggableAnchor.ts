import { useCallback, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";

/** Where an element rests in the free space of its parent: 0 is the start, 1 the end. */
export type Anchor = { x: number; y: number };

const DEFAULT_ANCHOR: Anchor = { x: 1, y: 0 };
const EDGE_GAP_PX = 8;
const KEY_STEP = 0.05;

const KEY_STEPS: Record<string, Anchor> = {
  ArrowLeft: { x: -KEY_STEP, y: 0 },
  ArrowRight: { x: KEY_STEP, y: 0 },
  ArrowUp: { x: 0, y: -KEY_STEP },
  ArrowDown: { x: 0, y: KEY_STEP },
};

const toUnit = (value: number) => Math.min(1, Math.max(0, value));

export function movedAnchor(anchor: Anchor, step: Anchor): Anchor {
  return { x: toUnit(anchor.x + step.x), y: toUnit(anchor.y + step.y) };
}

/** Converts pixels dragged into anchor units; with no free space the anchor stays put. */
export function dragStep(draggedPx: number, freeSpacePx: number): number {
  return freeSpacePx > 0 ? draggedPx / freeSpacePx : 0;
}

/** Anchoring by free space keeps the element inside its parent at any size. */
export function anchorStyle({ x, y }: Anchor) {
  return {
    left: `calc(${EDGE_GAP_PX}px + ${x} * (100% - ${2 * EDGE_GAP_PX}px))`,
    top: `calc(${EDGE_GAP_PX}px + ${y} * (100% - ${2 * EDGE_GAP_PX}px))`,
    transform: `translate(${-x * 100}%, ${-y * 100}%)`,
  };
}

function freeSpace(element: HTMLElement) {
  const parent = element.parentElement;
  return {
    width: (parent?.clientWidth ?? 0) - 2 * EDGE_GAP_PX - element.offsetWidth,
    height: (parent?.clientHeight ?? 0) - 2 * EDGE_GAP_PX - element.offsetHeight,
  };
}

function stopEvent(event: Event) {
  event.stopPropagation();
}

/** uPlot listens on the plot directly, so React's delegated stopPropagation comes too late. */
function shieldFromPlot(element: HTMLElement | null) {
  element?.addEventListener("mousedown", stopEvent);
  element?.addEventListener("dblclick", stopEvent);
}

export function useDraggableAnchor() {
  const [anchor, setAnchor] = useState(DEFAULT_ANCHOR);
  const dragRef = useRef<{ pointerX: number; pointerY: number; start: Anchor } | null>(null);

  const reset = useCallback(() => setAnchor(DEFAULT_ANCHOR), []);

  const handlers = {
    ref: shieldFromPlot,
    onPointerDown: (event: PointerEvent<HTMLElement>) => {
      event.currentTarget.setPointerCapture(event.pointerId);
      dragRef.current = { pointerX: event.clientX, pointerY: event.clientY, start: anchor };
    },
    onPointerMove: (event: PointerEvent<HTMLElement>) => {
      const drag = dragRef.current;
      if (!drag) return;
      const free = freeSpace(event.currentTarget);
      setAnchor(
        movedAnchor(drag.start, {
          x: dragStep(event.clientX - drag.pointerX, free.width),
          y: dragStep(event.clientY - drag.pointerY, free.height),
        }),
      );
    },
    onPointerUp: () => {
      dragRef.current = null;
    },
    onPointerCancel: () => {
      dragRef.current = null;
    },
    onKeyDown: (event: KeyboardEvent<HTMLElement>) => {
      const step = KEY_STEPS[event.key];
      if (!step) return;
      event.preventDefault();
      setAnchor((previous) => movedAnchor(previous, step));
    },
  };

  return { anchor, handlers, reset };
}
