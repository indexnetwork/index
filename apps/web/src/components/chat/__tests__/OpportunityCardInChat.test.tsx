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
