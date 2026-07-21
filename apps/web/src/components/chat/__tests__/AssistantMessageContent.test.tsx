import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import AssistantMessageContent, { parseAllBlocks } from "../AssistantMessageContent";

const proposalId = "11111111-1111-4111-8111-111111111111";
const entityId = "22222222-2222-4222-8222-222222222222";
const fence = (id = proposalId) => [
  "```agent_action_proposal",
  JSON.stringify({
    proposalId: id,
    actions: [{
      type: "pause_signal",
      entityId,
      currentState: "ACTIVE",
      proposedOperation: "PAUSE_SIGNAL",
      skipped: false,
    }],
  }),
  "```",
].join("\n");

const response = {
  success: true as const,
  proposalId,
  status: "consumed" as const,
  results: [{
    type: "pause_signal" as const,
    entityId,
    operation: "PAUSE_SIGNAL",
    previousState: "ACTIVE",
    resultingState: "PAUSED",
    outcome: "applied" as const,
  }],
};

describe("AssistantMessageContent agent action proposals", () => {
  it("renders a valid proposal fence as one card, including persisted content", () => {
    const live = parseAllBlocks(fence());
    const persisted = parseAllBlocks(fence());
    expect(live).toEqual(persisted);
    expect(live.filter((segment) => segment.type === "agent_action_proposal")).toHaveLength(1);

    render(
      <AssistantMessageContent
        content={`${fence()}\n\n${fence()}`}
        isStreaming={false}
        onAgentActionConfirm={vi.fn().mockResolvedValue(response)}
      />,
    );

    expect(screen.getByTestId("agent-action-proposal-card")).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "Confirm" })).toHaveLength(1);
    expect(screen.queryByText(/agent_action_proposal/)).not.toBeInTheDocument();
  });

  it("keeps malformed and unknown action data inert without a confirm control", () => {
    const malformed = [
      "```agent_action_proposal",
      JSON.stringify({ proposalId, actions: [{ type: "delete_everything", entityId, currentState: "ACTIVE", proposedOperation: "DELETE" }] }),
      "```",
    ].join("\n");
    render(
      <AssistantMessageContent
        content={malformed}
        isStreaming={false}
        onAgentActionConfirm={vi.fn()}
      />,
    );

    expect(screen.queryByTestId("agent-action-proposal-card")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Confirm" })).not.toBeInTheDocument();
    expect(document.querySelector("code.language-agent_action_proposal")).toBeInTheDocument();
  });

  it("shows a loading card for a partial streamed proposal fence", () => {
    render(
      <AssistantMessageContent
        content={`Preparing…\n${"```agent_action_proposal"}\n{"proposalId":"${proposalId}"`}
        isStreaming
      />,
    );

    expect(screen.getByTestId("agent-action-proposal-loading")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Confirm" })).not.toBeInTheDocument();
  });

  it("confirms with the proposal id only and renders returned results", async () => {
    const onConfirm = vi.fn().mockResolvedValue(response);
    render(
      <AssistantMessageContent
        content={fence()}
        isStreaming={false}
        onAgentActionConfirm={onConfirm}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Confirm" }));
    await waitFor(() => expect(onConfirm).toHaveBeenCalledWith(proposalId));
    expect(await screen.findByRole("status")).toHaveTextContent(/Confirmed safely/);
    expect(screen.getByText(/ACTIVE → PAUSED/)).toBeInTheDocument();
  });
});
