import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { describe, expect, it, vi } from "vitest";

import OpportunityCard, { type OpportunityCardData } from "@/components/chat/OpportunityCardInChat";

const baseCard: OpportunityCardData = {
  opportunityId: "opp-1",
  userId: "user-2",
  name: "Aisha Khan",
  mainText: "Your agents are debating a connection.",
  status: "negotiating",
};

describe("OpportunityCard negotiation lifecycle", () => {
  it("keeps negotiating informational and links to the owner-seat inspector", () => {
    const action = vi.fn();
    render(
      <MemoryRouter>
        <OpportunityCard
          card={baseCard}
          negotiationInspectorHref="/i/intent-7/negotiations/task-1"
          negotiationState={{ state: "working", pause: null }}
          onPrimaryAction={action}
          onSecondaryAction={action}
        />
      </MemoryRouter>,
    );

    expect(screen.getByText(/Your PersonalAgent is handling this negotiation/)).toBeTruthy();
    expect(screen.getByRole("link", { name: "Inspect negotiation seat" }).getAttribute("href"))
      .toBe("/i/intent-7/negotiations/task-1");
    expect(screen.queryByRole("button", { name: "Start Chat" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Skip" })).toBeNull();
  });

  it("shows waiting copy for a counterparty-owned verdict pause", () => {
    render(
      <MemoryRouter>
        <OpportunityCard
          card={baseCard}
          negotiationState={{ state: "paused", pause: { reason: "ready_for_verdict", by: "theirs" } }}
        />
      </MemoryRouter>,
    );

    expect(screen.getByText("The other side is deciding.")).toBeTruthy();
    expect(screen.queryByText(/Your PersonalAgent is handling/)).toBeNull();
    expect(screen.queryByText(/Questions appear/)).toBeNull();
  });

  it("keeps pending opportunities owner-actionable", () => {
    render(
      <MemoryRouter>
        <OpportunityCard card={{ ...baseCard, status: "pending" }} onPrimaryAction={vi.fn()} onSecondaryAction={vi.fn()} />
      </MemoryRouter>,
    );

    expect(screen.getByRole("button", { name: "Start Chat" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Skip" })).toBeTruthy();
  });

  it("does not expose a pending Radar card before its negotiation completes", () => {
    render(
      <MemoryRouter>
        <OpportunityCard
          card={{ ...baseCard, status: "pending" }}
          pendingActionable={false}
          onPrimaryAction={vi.fn()}
          onSecondaryAction={vi.fn()}
        />
      </MemoryRouter>,
    );

    expect(screen.queryByRole("button", { name: "Start Chat" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Skip" })).toBeNull();
  });
});
