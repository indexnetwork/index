import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ComponentProps } from "react";
import { describe, expect, it, vi } from "vitest";

import { ProposalCard, type GuidedProposal } from "./GuidedSignalIntake";

const proposal: GuidedProposal = {
  proposalId: "proposal-1",
  description: "Meet climate founders who need a technical cofounder.",
};

function renderProposalCard(overrides: Partial<ComponentProps<typeof ProposalCard>> = {}) {
  const onConfirm = vi.fn().mockResolvedValue(undefined);
  const onFeedback = vi.fn().mockResolvedValue(undefined);
  render(
    <ProposalCard
      proposal={proposal}
      networkTitle="Everywhere"
      onConfirm={onConfirm}
      onFeedback={onFeedback}
      onSkip={vi.fn().mockResolvedValue(undefined)}
      busy={false}
      error={null}
      {...overrides}
    />,
  );
  return { onConfirm, onFeedback };
}

describe("ProposalCard", () => {
  it("confirms the exact edited signal description", async () => {
    const { onConfirm } = renderProposalCard();
    const description = "Meet climate founders who need a technical cofounder in Berlin.";

    fireEvent.change(screen.getByLabelText("YOUR SIGNAL"), { target: { value: description } });
    fireEvent.click(screen.getByRole("button", { name: "Confirm signal" }));

    await waitFor(() => expect(onConfirm).toHaveBeenCalledWith(description));
  });

  it("sends feedback to request a replacement proposal rather than confirming the current draft", async () => {
    const { onConfirm, onFeedback } = renderProposalCard();

    fireEvent.change(screen.getByLabelText("Want your agent to revise it?"), {
      target: { value: "Make it clear that I can help with fundraising strategy." },
    });
    fireEvent.click(screen.getByRole("button", { name: "Revise with agent" }));

    await waitFor(() => expect(onFeedback).toHaveBeenCalledWith("Make it clear that I can help with fundraising strategy."));
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("shows feedback failures and lets the user retry", async () => {
    const onFeedback = vi.fn().mockRejectedValue(new Error("offline"));
    renderProposalCard({ onFeedback });

    fireEvent.change(screen.getByLabelText("Want your agent to revise it?"), { target: { value: "Be more specific." } });
    fireEvent.click(screen.getByRole("button", { name: "Revise with agent" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Couldn't send your feedback. Please try again.");
    expect(screen.getByRole("button", { name: "Revise with agent" })).toBeEnabled();
  });
});
