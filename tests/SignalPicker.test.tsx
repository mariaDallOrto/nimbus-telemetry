import { describe, expect, test } from "bun:test";
import { useState } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { SignalPicker } from "../src/charts/SignalPicker";

const SIGNALS = [
  { id: "Corrente_Med_A", label: "Corrente média", group: "Corrente", color: "#f00" },
  { id: "Comando_Pct", label: "Stick", group: "Comando", color: "#00f" },
  { id: "TensaoTotal_V", label: "Tensão total", group: "Bateria", color: "#0f0" },
  { id: "C1", label: "Célula 1", group: "Células", color: "#ff0" },
];

function Harness() {
  const [ids, setIds] = useState(["Comando_Pct"]);
  const toggle = (id: string) =>
    setIds((previous) =>
      previous.includes(id) ? previous.filter((other) => other !== id) : [...previous, id],
    );
  return <SignalPicker signals={SIGNALS} selectedIds={ids} onToggle={toggle} />;
}

function openPicker() {
  render(<Harness />);
  const search = screen.getByRole("combobox");
  fireEvent.focus(search);
  return search;
}

const optionLabels = () => screen.getAllByRole("option").map((option) => option.textContent);

describe("SignalPicker", () => {
  test("keeps the list closed until the field gets focus", () => {
    render(<Harness />);
    expect(screen.queryByRole("listbox")).toBeNull();
  });

  test("lists every signal and marks the plotted ones", () => {
    openPicker();
    expect(screen.getAllByRole("option")).toHaveLength(4);
    expect(screen.getByRole("option", { selected: true }).textContent).toContain("Stick");
  });

  test("filters with a fuzzy, accent-free query", () => {
    const search = openPicker();
    fireEvent.change(search, { target: { value: "tensao" } });
    expect(optionLabels()).toEqual([expect.stringContaining("Tensão total")]);
  });

  test("finds signals by group", () => {
    const search = openPicker();
    fireEvent.change(search, { target: { value: "bateria" } });
    expect(optionLabels()).toEqual([expect.stringContaining("Tensão total")]);
  });

  test("tells when nothing matches", () => {
    const search = openPicker();
    fireEvent.change(search, { target: { value: "xyz" } });
    expect(screen.getByRole("listbox").textContent).toContain("xyz");
  });

  test("toggles the highlighted signal with the keyboard and stays open", () => {
    const search = openPicker();
    fireEvent.keyDown(search, { key: "ArrowDown" });
    fireEvent.keyDown(search, { key: "Enter" });
    expect(screen.getByRole("option", { name: /Stick/ }).getAttribute("aria-selected")).toBe(
      "false",
    );
  });

  test("toggles a signal on click and stays open", () => {
    openPicker();
    fireEvent.click(screen.getByRole("option", { name: /Célula 1/ }));
    expect(screen.getAllByRole("option", { selected: true })).toHaveLength(2);
  });

  test("closes on Escape and clears the search", () => {
    const search = openPicker() as HTMLInputElement;
    fireEvent.change(search, { target: { value: "st" } });
    fireEvent.keyDown(search, { key: "Escape" });
    expect(screen.queryByRole("listbox")).toBeNull();
    expect(search.value).toBe("");
  });
});
