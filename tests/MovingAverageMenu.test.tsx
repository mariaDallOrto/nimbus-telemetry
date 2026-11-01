import { describe, expect, mock, test } from "bun:test";
import { fireEvent, render, screen } from "@testing-library/react";
import { MovingAverageMenu } from "../src/charts/MovingAverageMenu";

const SIGNALS = [{ id: "current", label: "Corrente", color: "#ff5c7c" }];

function open(onWindowChange = mock()) {
  render(
    <MovingAverageMenu signals={SIGNALS} windowOf={() => 15} onWindowChange={onWindowChange} />,
  );
  fireEvent.click(screen.getByRole("button", { name: "Média móvel" }));
  return onWindowChange;
}

describe("MovingAverageMenu", () => {
  test("hides the settings until it is opened", () => {
    render(<MovingAverageMenu signals={SIGNALS} windowOf={() => 15} onWindowChange={mock()} />);
    expect(screen.queryByLabelText("Média móvel de Corrente, em pontos")).toBeNull();
  });

  test("changes the window of a signal", () => {
    const onWindowChange = open();
    const input = screen.getByLabelText("Média móvel de Corrente, em pontos");
    fireEvent.change(input, { target: { value: "20" } });
    fireEvent.blur(input);
    expect(onWindowChange).toHaveBeenCalledWith("current", 20);
  });

  test("closes on Escape", () => {
    open();
    fireEvent.keyDown(screen.getByLabelText("Média móvel de Corrente, em pontos"), {
      key: "Escape",
    });
    expect(screen.queryByLabelText("Média móvel de Corrente, em pontos")).toBeNull();
  });
});
