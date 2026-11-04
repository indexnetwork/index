import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { describe, expect, it, vi } from "vitest";

import { MatchCard } from "./mac-blocks";

const base = {
  name: "Cap",
  blurb: "Exchange architectural feedback",
  accepted: false,
  ready: true,
  negotiating: false,
  expired: false,
  hasChat: false,
  onOpen: vi.fn(),
  onOpenChat: vi.fn(),
  onProfile: vi.fn(),
  onAccept: vi.fn(),
  onPass: vi.fn(),
};

function renderCard(props: Partial<Parameters<typeof MatchCard>[0]> = {}) {
  return render(<MemoryRouter><MatchCard statusLabel="awaiting you" {...base} {...props} /></MemoryRouter>);
}

describe("MatchCard", () => {
  it("puts the stage and age under the buttons", () => {
    renderCard({ age: "3h" });
    const label = screen.getByText("awaiting you · 3h");
    const pass = screen.getByRole("button", { name: "pass" });
    expect(pass.compareDocumentPosition(label) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("shows the stage alone when the age is unknown", () => {
    renderCard({ age: null, accepted: true, ready: false, hasChat: true, statusLabel: "accepted" });
    expect(screen.getByText("accepted")).toBeInTheDocument();
    expect(screen.queryByText("chat open")).not.toBeInTheDocument();
  });

  it("fades a stale card", () => {
    const { container } = renderCard({ age: "5d", stale: true });
    expect((container.querySelector("div[style]") as HTMLElement).style.opacity).toBe("0.5");
  });
});
