import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { describe, expect, it, vi } from "vitest";

import { EmptyState } from "./EmptyState";
import { radarEmptyLine } from "@/lib/radar-buckets";
import { APIError, isNotFoundError } from "@/lib/api";

describe("EmptyState", () => {
  it("defaults the loading tone to the canonical loading line", () => {
    render(<EmptyState tone="loading" />);
    expect(screen.getByRole("status")).toHaveTextContent("loading…");
  });

  it("announces errors and runs the retry action", () => {
    const retry = vi.fn();
    render(<EmptyState tone="error" message="couldn't load members." action={{ label: "try again", onClick: retry }} />);
    expect(screen.getByRole("alert")).toHaveTextContent("couldn't load members.");
    fireEvent.click(screen.getByRole("button", { name: "try again" }));
    expect(retry).toHaveBeenCalledOnce();
  });

  it("renders link actions and several actions side by side", () => {
    render(
      <MemoryRouter>
        <EmptyState
          message="you're not in any networks yet."
          action={[
            { label: "create a network", onClick: () => {} },
            { label: "discover networks", to: "/networks" },
          ]}
        />
      </MemoryRouter>,
    );
    expect(screen.getByRole("button", { name: "create a network" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "discover networks" })).toHaveAttribute("href", "/networks");
  });
});

describe("empty-state copy", () => {
  it("uses the canonical radar lines", () => {
    expect(radarEmptyLine("awaiting you")).toBe("nothing waiting on you right now.");
    expect(radarEmptyLine("accepted")).toBe("no one accepted yet.");
    expect(radarEmptyLine("missed")).toBe("nothing missed.");
  });

  it("treats only a real 404 as not found", () => {
    expect(isNotFoundError(new APIError("gone", 404))).toBe(true);
    expect(isNotFoundError(new APIError("boom", 500))).toBe(false);
    expect(isNotFoundError(new APIError("offline", 0))).toBe(false);
    expect(isNotFoundError(new Error("x"))).toBe(false);
  });
});
