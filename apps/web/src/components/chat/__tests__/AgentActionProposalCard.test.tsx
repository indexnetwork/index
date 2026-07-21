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

const resolved = (actions = card.actions, status: "pending" | "consumed" = "pending") => ({
  success: true as const,
  proposalId: card.proposalId,
  status,
  actions,
  results: status === "consumed" ? result("consumed").results : null,
});

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
    render(<AgentActionProposalCard card={card} onResolve={vi.fn().mockResolvedValue(resolved())} onConfirm={onConfirm} />);

    await screen.findByRole("button", { name: "Confirm" });
    fireEvent.click(screen.getByRole("button", { name: "Confirm" }));
    await screen.findByText("Confirmed safely.");
    fireEvent.click(screen.getByRole("button", { name: "Confirm again" }));
    await waitFor(() => expect(onConfirm).toHaveBeenCalledTimes(2));
    expect(await screen.findByText(/Already confirmed — replayed safely/)).toBeInTheDocument();
  });

  it("hydrates consumed proposals with their canonical results and replay control", async () => {
    render(<AgentActionProposalCard card={card} onResolve={vi.fn().mockResolvedValue(resolved(card.actions, "consumed"))} onConfirm={vi.fn()} />);

    expect(await screen.findByRole("status")).toHaveTextContent("Already confirmed.");
    expect(screen.getByRole("button", { name: "Confirm again" })).toBeInTheDocument();
    expect(screen.getByText(/ACTIVE → RETRACTED/)).toBeInTheDocument();
  });

  it("stays inert when canonical resolution returns a different proposal", async () => {
    render(<AgentActionProposalCard card={card} onResolve={vi.fn().mockResolvedValue({ ...resolved(), proposalId: "99999999-9999-4999-8999-999999999999" })} onConfirm={vi.fn()} />);

    await waitFor(() => expect(screen.queryByTestId("agent-action-proposal-loading")).not.toBeInTheDocument());
    expect(screen.queryByTestId("agent-action-proposal-card")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Confirm/ })).not.toBeInTheDocument();
  });

  it("renders the canonical narrow-signal replacement text instead of fence text", async () => {
    const canonicalAction = {
      type: "narrow_signal" as const,
      entityId: card.actions[0].entityId,
      currentState: "ACTIVE",
      proposedOperation: "NARROW_SIGNAL",
      description: "Find local product collaborators",
    };
    const fenceAction = { ...canonicalAction, description: "Untrusted fence replacement" };
    render(<AgentActionProposalCard card={{ ...card, actions: [fenceAction] }} onResolve={vi.fn().mockResolvedValue(resolved([canonicalAction]))} onConfirm={vi.fn()} />);

    const label = await screen.findByText("Replacement signal:");
    expect(label.parentElement).toHaveTextContent(/^Replacement signal: Find local product collaborators$/);
    expect(screen.queryByText("Untrusted fence replacement")).not.toBeInTheDocument();
  });

  it("renders a retryable error and retries", async () => {
    const error = Object.assign(new Error("in progress"), { status: 409 });
    const onConfirm = vi.fn().mockRejectedValueOnce(error).mockResolvedValueOnce(result("replayed"));
    render(<AgentActionProposalCard card={card} onResolve={vi.fn().mockResolvedValue(resolved())} onConfirm={onConfirm} />);

    fireEvent.click(await screen.findByRole("button", { name: "Confirm" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/still in progress/);
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(await screen.findByRole("status")).toHaveTextContent(/replayed safely/);
  });
});
