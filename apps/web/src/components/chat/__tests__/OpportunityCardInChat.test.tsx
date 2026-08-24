import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { describe, expect, it } from "vitest";

import OpportunityCard, { type OpportunityCardData } from "@/components/chat/OpportunityCardInChat";

const baseCard: OpportunityCardData = {
  opportunityId: "opp-1",
  userId: "user-2",
  name: "Aisha Khan",
  mainText: "Your agents are debating a connection.",
  status: "negotiating",
};

const presence = {
  conversationId: "conv-1",
  latestMove: "Their agent countered · 12m ago",
  turnCount: 3,
  maxTurns: 6,
};

function renderCard(card: OpportunityCardData, withPresence = false) {
  return render(
    <MemoryRouter>
      <OpportunityCard card={card} {...(withPresence ? { negotiationPresence: presence } : {})} />
    </MemoryRouter>,
  );
}

describe("OpportunityCard negotiation presence", () => {
  it("renders the templated chip, latest move, and human gate for negotiating cards", () => {
    renderCard(baseCard, true);

    expect(screen.getByText("Currently negotiating · turn 3 of 6")).toBeTruthy();
    expect(screen.getByText("Their agent countered · 12m ago")).toBeTruthy();
    expect(screen.getByText("You'll be asked before anything is agreed")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Watch the negotiation" })).toBeTruthy();
  });

  it("omits the turn counter until the first turn completes", () => {
    render(
      <MemoryRouter>
        <OpportunityCard
          card={baseCard}
          negotiationPresence={{ ...presence, turnCount: 0 }}
        />
      </MemoryRouter>,
    );

    expect(screen.getByText("Currently negotiating")).toBeTruthy();
    expect(screen.queryByText(/turn \d+ of \d+/)).toBeNull();
  });

  it("renders nothing without presence data", () => {
    renderCard(baseCard);

    expect(screen.queryByText(/Currently negotiating/)).toBeNull();
  });

  it("renders nothing when the card is no longer negotiating", () => {
    renderCard({ ...baseCard, status: "pending" }, true);

    expect(screen.queryByText(/Currently negotiating/)).toBeNull();
  });
});

describe("OpportunityCard asking-you-first state", () => {
  // A pre-contact park (#1445) leaves the opportunity `negotiating`, so the
  // presenter hands us the in-flight template: "still talking with theirs", "no
  // action needed yet", plus the presence chip. All three are false while the
  // negotiation is parked before any contact, and the card must not show them.
  const askingFirst = {
    intentId: "intent-7",
    reason: "unresolved_owner_constraint",
    whatFit: "Consumer-AI founder with strong general AI depth.",
  };

  it("renders the asking-first card in place of the negotiating body", () => {
    renderCard({ ...baseCard, askingFirst }, true);

    const card = screen.getByTestId("asking-first-card");
    expect(card).toHaveTextContent("Your agent wants to ask you first");
    expect(card).toHaveTextContent("Aisha Khan was not contacted and cannot see this.");
    expect(screen.getByRole("link", { name: "Answer in this signal's DM" }).getAttribute("href"))
      .toBe("/i/intent-7");
    expect(screen.queryByText("Your agents are debating a connection.")).toBeNull();
  });

  it("suppresses the negotiation presence, which would claim a dialogue that has not started", () => {
    renderCard({ ...baseCard, askingFirst }, true);

    expect(screen.queryByText(/Currently negotiating/)).toBeNull();
    expect(screen.queryByRole("button", { name: "Watch the negotiation" })).toBeNull();
  });

  it("leaves an ordinary negotiating card alone", () => {
    renderCard(baseCard, true);

    expect(screen.queryByTestId("asking-first-card")).toBeNull();
    expect(screen.getByText("Your agents are debating a connection.")).toBeTruthy();
  });
});
