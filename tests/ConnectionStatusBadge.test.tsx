import { describe, expect, test } from "bun:test";
import { render, screen } from "@testing-library/react";
import { ConnectionStatusBadge } from "../src/components/ConnectionStatusBadge";

describe("ConnectionStatusBadge", () => {
  test("labels the offline state in Portuguese", () => {
    render(<ConnectionStatusBadge status="offline" />);
    expect(screen.getByText("Desconectado")).toBeInTheDocument();
  });

  test("exposes the state via a data attribute for styling", () => {
    render(<ConnectionStatusBadge status="online" />);
    const badge = screen.getByRole("status");
    expect(badge).toHaveAttribute("data-state", "online");
  });

  test("announces the connecting state", () => {
    render(<ConnectionStatusBadge status="connecting" />);
    expect(screen.getByText("Conectando")).toBeInTheDocument();
  });
});
