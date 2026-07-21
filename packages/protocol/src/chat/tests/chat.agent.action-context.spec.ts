import { AIMessage, HumanMessage } from "@langchain/core/messages";
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
  it("uses only assistant content before the current human turn", () => {
    expect(ChatAgent.hasPriorAgentActionProposal([
      new AIMessage({ content: proposal }),
      new HumanMessage("yes"),
    ])).toBe(true);

    expect(ChatAgent.hasPriorAgentActionProposal([
      new HumanMessage("yes"),
      new AIMessage({ content: proposal }),
    ])).toBe(false);
  });

  it("rejects malformed or current-turn-only fences", () => {
    expect(ChatAgent.hasPriorAgentActionProposal([
      new AIMessage({ content: "```agent_action_proposal\nnot json\n```" }),
      new HumanMessage("yes"),
    ])).toBe(false);
    expect(ChatAgent.hasPriorAgentActionProposal([
      new HumanMessage(proposal),
    ])).toBe(false);
  });
});
