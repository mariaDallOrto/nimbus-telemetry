import { describe, expect, test } from "bun:test";
import { useState } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { NumberInput } from "../src/components/NumberInput";

function Harness() {
  const [value, setValue] = useState(1);
  return <NumberInput value={value} min={1} max={500} aria-label="ma" onValueChange={setValue} />;
}

describe("NumberInput", () => {
  test("can be cleared without snapping back to the default", () => {
    render(<Harness />);
    const input = screen.getByLabelText("ma") as HTMLInputElement;
    expect(input.value).toBe("1");
    fireEvent.change(input, { target: { value: "" } });
    expect(input.value).toBe("");
  });

  test("commits a freshly typed multi-digit value", () => {
    render(<Harness />);
    const input = screen.getByLabelText("ma") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "" } });
    fireEvent.change(input, { target: { value: "50" } });
    expect(input.value).toBe("50");
  });

  test("clamps above the max on blur", () => {
    render(<Harness />);
    const input = screen.getByLabelText("ma") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "9999" } });
    fireEvent.blur(input);
    expect(input.value).toBe("500");
  });

  test("restores the last committed value when blurred empty", () => {
    render(<Harness />);
    const input = screen.getByLabelText("ma") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "50" } });
    fireEvent.change(input, { target: { value: "" } });
    fireEvent.blur(input);
    expect(input.value).toBe("50");
  });

  test("accepts comma as a decimal separator", () => {
    render(<NumberInput value={0.1} min={0} aria-label="ohms" onValueChange={() => {}} />);
    const input = screen.getByLabelText("ohms") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "0,05" } });
    expect(input.value).toBe("0,05");
  });
});
