import { AIMessage, HumanMessage, SystemMessage, ToolMessage } from "@langchain/core/messages";
import { describe, expect, it } from "bun:test";

import { ChatAgent } from "../chat.agent.js";

const proposal = [
  "```agent_action_proposal",
  JSON.stringify({
    proposalId: "11111111-1111-4111-8111-111111111111",
    actions: [{ type: "pause_signal", entityId: "signal-1", currentState: "ACTIVE", proposedOperation: "PAUSE_SIGNAL" }],
  }),
  "```",
].join("\n");

describe("ChatAgent prior action proposal context", () => {
  it("uses the latest assistant response after the immediately previous human turn", () => {
    expect(ChatAgent.hasPriorAgentActionProposal([
      new HumanMessage("Review my signals"),
      new AIMessage({ content: proposal }),
      new ToolMessage({ content: "tool detail", tool_call_id: "tool-1" }),
      new SystemMessage("internal context"),
      new HumanMessage("yes"),
    ])).toBe(true);

    expect(ChatAgent.hasPriorAgentActionProposal([
      new HumanMessage("yes"),
      new AIMessage({ content: proposal }),
    ])).toBe(false);
  });

  it("does not reuse a proposal when a later assistant response intervenes", () => {
    expect(ChatAgent.hasPriorAgentActionProposal([
      new HumanMessage("Review my signals"),
      new AIMessage({ content: proposal }),
      new AIMessage({ content: "I could not prepare a current action card." }),
      new HumanMessage("confirm it"),
    ])).toBe(false);
  });

  it("does not reuse old or consumed-style proposal history across human turns", () => {
    expect(ChatAgent.hasPriorAgentActionProposal([
      new HumanMessage("Review my signals"),
      new AIMessage({ content: proposal }),
      new HumanMessage("I already handled that"),
      new AIMessage({ content: "That earlier proposal is already consumed." }),
      new HumanMessage("confirm it"),
    ])).toBe(false);
  });

  it("rejects malformed, non-canonical, or current-turn-only fences", () => {
    expect(ChatAgent.hasPriorAgentActionProposal([
      new HumanMessage("Review my signals"),
      new AIMessage({ content: "```agent_action_proposal\nnot json\n```" }),
      new HumanMessage("yes"),
    ])).toBe(false);
    expect(ChatAgent.hasPriorAgentActionProposal([
      new HumanMessage("Review my signals"),
      new AIMessage({ content: proposal.replace('"PAUSE_SIGNAL"', '"DELETE_SIGNAL"') }),
      new HumanMessage("yes"),
    ])).toBe(false);
    expect(ChatAgent.hasPriorAgentActionProposal([
      new HumanMessage("Review my signals"),
      new AIMessage({ content: proposal.replace('"actions":', '"snapshot":{"payload":"private"},"actions":') }),
      new HumanMessage("yes"),
    ])).toBe(false);
    expect(ChatAgent.hasPriorAgentActionProposal([
      new HumanMessage(proposal),
    ])).toBe(false);
  });
});
