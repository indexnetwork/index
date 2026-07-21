import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import AgentActionProposalCard, { type AgentActionProposalData } from "../AgentActionProposalCard";

const card: AgentActionProposalData = {
  proposalId: "11111111-1111-4111-8111-111111111111",
  actions: [{
    type: "retract_premise",
    entityId: "22222222-2222-4222-8222-222222222222",
    currentState: "ACTIVE",
    proposedOperation: "RETRACT_PREMISE",
  }],
};

const result = (status: "consumed" | "replayed") => ({
  success: true as const,
  proposalId: card.proposalId,
  status,
  results: [{
    type: "retract_premise" as const,
    entityId: card.actions[0].entityId,
    operation: "RETRACT_PREMISE",
    previousState: "ACTIVE",
    resultingState: "RETRACTED",
    outcome: "applied" as const,
  }],
});

describe("AgentActionProposalCard", () => {
  it("shows replay state and safely permits another idempotent confirmation", async () => {
    const onConfirm = vi.fn()
      .mockResolvedValueOnce(result("consumed"))
      .mockResolvedValueOnce(result("replayed"));
    render(<AgentActionProposalCard card={card} onConfirm={onConfirm} />);

    fireEvent.click(screen.getByRole("button", { name: "Confirm" }));
    await screen.findByText("Confirmed safely.");
    fireEvent.click(screen.getByRole("button", { name: "Confirm again" }));
    await waitFor(() => expect(onConfirm).toHaveBeenCalledTimes(2));
    expect(await screen.findByText(/Already confirmed — replayed safely/)).toBeInTheDocument();
  });

  it("renders a retryable error and retries", async () => {
    const error = Object.assign(new Error("in progress"), { status: 409 });
    const onConfirm = vi.fn().mockRejectedValueOnce(error).mockResolvedValueOnce(result("replayed"));
    render(<AgentActionProposalCard card={card} onConfirm={onConfirm} />);

    fireEvent.click(screen.getByRole("button", { name: "Confirm" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/still in progress/);
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(await screen.findByRole("status")).toHaveTextContent(/replayed safely/);
  });
});
