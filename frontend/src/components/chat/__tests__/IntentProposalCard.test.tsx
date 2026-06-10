import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import IntentProposalCard, { type IntentProposalData } from "../IntentProposalCard";

const baseCard: IntentProposalData = {
  proposalId: "proposal-1",
  description: "Find agent builders for TypeScript protocol tooling",
};

describe("IntentProposalCard", () => {
  it("treats null-like warning strings as absent for non-broad proposals", () => {
    render(
      <IntentProposalCard
        card={{
          ...baseCard,
          referentialBreadth: "narrow",
          specificityWarning: " NuLl ",
        }}
        currentStatus="pending"
        onApprove={vi.fn()}
        onReject={vi.fn()}
      />,
    );

    expect(screen.queryByText(/^null$/i)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /create anyway/i })).not.toBeInTheDocument();
    expect(screen.getByTitle("Create now")).toBeInTheDocument();
  });

  it("falls back to the default warning for broad proposals with null-like warning strings", () => {
    render(
      <IntentProposalCard
        card={{
          ...baseCard,
          referentialBreadth: "broad",
          specificityWarning: "undefined",
        }}
        currentStatus="pending"
        onApprove={vi.fn()}
        onReject={vi.fn()}
      />,
    );

    expect(screen.queryByText(/^undefined$/i)).not.toBeInTheDocument();
    expect(screen.getByText(/This signal is broad and may produce many weak matches/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /create anyway/i })).toBeInTheDocument();
  });
});
