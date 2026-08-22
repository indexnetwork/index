/**
 * The one sentence every surface that speaks AS the user's own agent opens
 * with. Two axes, four forms: the agent may or may not have a name on its
 * `type='personal'` row, and the surface may or may not name the client.
 * Neither absence may reintroduce a product noun, and neither may throw —
 * the unattended IntentAgent loop builds this sentence on every turn.
 */
import { describe, expect, it } from "bun:test";

import { buildAgentSelfIntroduction } from "../agent-identity.prompt.js";

describe("buildAgentSelfIntroduction", () => {
  it("names both parties when the surface knows both", () => {
    expect(buildAgentSelfIntroduction({
      agentName: "Ada's Agent",
      userName: "Ada",
      role: "the private signals and profile assistant",
    })).toBe("You are Ada's Agent, the private signals and profile assistant for Ada.");
  });

  it("falls back to the client's possessive — never a product noun — when the row is nameless", () => {
    expect(buildAgentSelfIntroduction({
      userName: "Ada",
      role: "the restricted setup assistant",
    })).toBe("You are Ada's personal agent, the restricted setup assistant.");
    expect(buildAgentSelfIntroduction({
      agentName: "   ",
      userName: "Ada",
      role: "the restricted setup assistant",
    })).toBe("You are Ada's personal agent, the restricted setup assistant.");
  });

  it("states the name alone on a surface that never names its client", () => {
    // The IntentAgent's law speaks of "your client" from end to end, so its
    // role phrase already carries the relationship and no userName is read.
    expect(buildAgentSelfIntroduction({
      agentName: "Ada's Agent",
      role: "your client's personal agent for ONE signal",
    })).toBe("You are Ada's Agent, your client's personal agent for ONE signal.");
  });

  it("degrades to the bare role when neither party is named", () => {
    expect(buildAgentSelfIntroduction({
      role: "your client's personal agent for ONE signal",
    })).toBe("You are your client's personal agent for ONE signal.");
  });
});
