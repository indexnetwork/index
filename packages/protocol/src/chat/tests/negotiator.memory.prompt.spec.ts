import { describe, it, expect } from "bun:test";

import { buildNegotiatorSystemContent, type NegotiatorPromptOptions } from "../negotiator.prompt.js";
import type { ResolvedToolContext } from "../../shared/agent/tool.factory.js";
import type { NegotiatorMemoryEntry } from "../../negotiation/negotiation.memory.js";

/**
 * IND-407 (P5.3) — negotiator chat persona memory injection.
 *
 * The DM audience is the client themself: memories render as shared context
 * ("Your negotiator memory"), not counterparty-facing secrets. No entries →
 * the prompt is byte-identical to the pre-P5.3 build.
 */

function makeCtx(): ResolvedToolContext {
  return {
    userId: "user-1",
    userName: "Alice Test",
    userEmail: "alice@example.com",
    user: { id: "user-1", name: "Alice Test", email: "alice@example.com" },
    userProfile: { bio: "Builder", skills: ["typescript"], interests: ["AI"] },
    userNetworks: [],
    indexName: undefined,
    isOwner: false,
    isOnboarding: false,
    hasName: true,
    contactsEnabled: false,
  } as unknown as ResolvedToolContext;
}

const AGENT_OPTS: NegotiatorPromptOptions = { agentName: "Alice's Negotiator" };

const memories: NegotiatorMemoryEntry[] = [
  { kind: "disclosure_rule", content: "Never share Alice's day rate before a scope is agreed.", confidence: 0.9 },
  { kind: "playbook", content: "Alice prefers intros framed around concrete projects.", confidence: 0.7 },
];

describe("buildNegotiatorSystemContent — memory section (IND-407)", () => {
  it("renders the client-facing memory section when entries are present", () => {
    const prompt = buildNegotiatorSystemContent(makeCtx(), { ...AGENT_OPTS, memory: memories });
    expect(prompt).toContain("## Your negotiator memory");
    expect(prompt).toContain("[disclosure rule] Never share Alice's day rate");
    expect(prompt).toContain("[playbook] Alice prefers intros framed around concrete projects");
    expect(prompt).toContain("trust the client");
    // Client-facing framing — not the counterparty leak-guard block.
    expect(prompt).not.toContain("PRIVATE NEGOTIATOR MEMORY");
  });

  it("keeps the prompt byte-identical when memory is absent or empty", () => {
    const withoutField = buildNegotiatorSystemContent(makeCtx(), AGENT_OPTS);
    const withEmpty = buildNegotiatorSystemContent(makeCtx(), { ...AGENT_OPTS, memory: [] });
    expect(withEmpty).toBe(withoutField);
    expect(withoutField).not.toContain("## Your negotiator memory");
  });
});
