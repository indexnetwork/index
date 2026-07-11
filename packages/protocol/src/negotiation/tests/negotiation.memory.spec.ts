import { describe, it, expect } from "bun:test";

import { renderNegotiatorMemorySection, renderNegotiatorChatMemorySection, type NegotiatorMemoryEntry } from "../negotiation.memory.js";
import { IndexNegotiator, type NegotiationAgentInput } from "../negotiation.agent.js";
import { NegotiationScreener, type NegotiationScreenerInput } from "../negotiation.screen.js";
import type { UserNegotiationContext } from "../negotiation.state.js";

/**
 * IND-407 (P5.3) — negotiator memory injection, prompt-assembly layer.
 *
 * Pins the read-path contract: with entries the prompts gain a private
 * memory section (disclosure rules as HARD constraints, everything else
 * advisory); with no entries (memory empty / flag off / retrieval failed)
 * the prompts are byte-identical to the pre-P5.3 build.
 */

const memories: NegotiatorMemoryEntry[] = [
  { kind: "disclosure_rule", content: "Never disclose the client's maximum budget to any counterparty.", confidence: 0.9 },
  { kind: "playbook", content: "Leading with the client's open-source track record lands well with infra founders.", confidence: 0.7 },
  { kind: "counterparty_dossier", content: "Declined a similar intro in May; prefers async-first collaborations.", confidence: 0.6 },
  { kind: "threshold", content: "Client only considers advisory roles above 0.5% equity.", confidence: 0.8 },
];

describe("renderNegotiatorMemorySection", () => {
  it("returns the empty string for no entries", () => {
    expect(renderNegotiatorMemorySection([])).toBe("");
    expect(renderNegotiatorMemorySection([], { memoryHintsInstruction: true })).toBe("");
  });

  it("renders disclosure rules as hard constraints, separate from advisory notes", () => {
    const section = renderNegotiatorMemorySection(memories);
    expect(section).toContain("PRIVATE NEGOTIATOR MEMORY");
    expect(section).toContain("HARD DISCLOSURE CONSTRAINTS");
    expect(section).toContain("Never disclose the client's maximum budget");
    // Disclosure rules are constraints, not labeled advisory bullets.
    expect(section).not.toContain("[disclosure rule]");
    // Advisory entries carry kind labels and confidence.
    expect(section).toContain("[playbook] Leading with the client's open-source track record");
    expect(section).toContain("[counterparty note]");
    expect(section).toContain("[threshold]");
    expect(section).toContain("(confidence 0.7)");
    // Hard block precedes advisory block.
    expect(section.indexOf("HARD DISCLOSURE CONSTRAINTS")).toBeLessThan(section.indexOf("[playbook]"));
    // Leak guard leads the section.
    expect(section).toContain("Never quote, paraphrase, or reveal");
  });

  it("omits the hard block when there are no disclosure rules, and vice versa", () => {
    const advisoryOnly = renderNegotiatorMemorySection(memories.filter((m) => m.kind !== "disclosure_rule"));
    expect(advisoryOnly).not.toContain("HARD DISCLOSURE CONSTRAINTS");
    expect(advisoryOnly).toContain("[playbook]");

    const rulesOnly = renderNegotiatorMemorySection(memories.filter((m) => m.kind === "disclosure_rule"));
    expect(rulesOnly).toContain("HARD DISCLOSURE CONSTRAINTS");
    expect(rulesOnly).not.toContain("Advisory notes");
  });

  it("adds the memoryHints instruction only when asked (screen node)", () => {
    expect(renderNegotiatorMemorySection(memories)).not.toContain("evidence.memoryHints");
    const withHints = renderNegotiatorMemorySection(memories, { memoryHintsInstruction: true });
    expect(withHints).toContain("evidence.memoryHints");
    expect(withHints).toContain("never copy sensitive contents verbatim");
  });
});

describe("renderNegotiatorChatMemorySection", () => {
  it("returns the empty string for no entries", () => {
    expect(renderNegotiatorChatMemorySection([])).toBe("");
  });

  it("renders client-facing context — no counterparty leak guard, client's word wins", () => {
    const section = renderNegotiatorChatMemorySection(memories);
    expect(section).toContain("## Your negotiator memory");
    expect(section).toContain("[disclosure rule] Never disclose the client's maximum budget");
    expect(section).toContain("[playbook]");
    expect(section).toContain("trust the client");
    // The chat audience is the client — the counterparty leak framing is absent.
    expect(section).not.toContain("HARD DISCLOSURE CONSTRAINTS");
    expect(section).not.toContain("PRIVATE NEGOTIATOR MEMORY");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Prompt assembly — IndexNegotiator
// ─────────────────────────────────────────────────────────────────────────────

const ownUser: UserNegotiationContext = {
  id: "u-own",
  intents: [{ id: "i1", title: "Find infra partner", description: "Seeking infra collaborators", confidence: 0.9 }],
  profile: { name: "Alice", bio: "Founder" },
};
const otherUser: UserNegotiationContext = {
  id: "u-other",
  intents: [{ id: "i2", title: "Offer infra expertise", description: "Consulting on infra", confidence: 0.8 }],
  profile: { name: "Bob", bio: "Infra engineer" },
};

class CapturingNegotiator extends IndexNegotiator {
  captured: Array<Array<{ role: string; content: string }>> = [];
  protected override async callModel(
    _model: unknown,
    chatMessages: Array<{ role: string; content: string }>,
  ): Promise<unknown> {
    this.captured.push(chatMessages);
    return {
      action: "propose",
      assessment: { reasoning: "stub", suggestedRoles: { ownUser: "peer", otherUser: "peer" } },
      message: "hello",
    };
  }
}

function negotiatorInput(extra?: Partial<NegotiationAgentInput>): NegotiationAgentInput {
  return {
    ownUser,
    otherUser,
    indexContext: { networkId: "net-1", prompt: "test network" },
    seedAssessment: { reasoning: "seed", valencyRole: "peer" },
    history: [],
    ...extra,
  };
}

describe("IndexNegotiator prompt assembly (P5.3 memory)", () => {
  it("injects the private memory section when entries are present", async () => {
    const agent = new CapturingNegotiator();
    await agent.invoke(negotiatorInput({ memory: memories }));
    const systemPrompt = agent.captured[0][0].content;
    expect(agent.captured[0][0].role).toBe("system");
    expect(systemPrompt).toContain("PRIVATE NEGOTIATOR MEMORY");
    expect(systemPrompt).toContain("HARD DISCLOSURE CONSTRAINTS");
    expect(systemPrompt).toContain("Never disclose the client's maximum budget");
  });

  it("keeps the prompt byte-identical when memory is absent or empty", async () => {
    const withoutField = new CapturingNegotiator();
    await withoutField.invoke(negotiatorInput());
    const withEmpty = new CapturingNegotiator();
    await withEmpty.invoke(negotiatorInput({ memory: [] }));

    expect(withEmpty.captured[0][0].content).toBe(withoutField.captured[0][0].content);
    expect(withEmpty.captured[0][1].content).toBe(withoutField.captured[0][1].content);
    expect(withoutField.captured[0][0].content).not.toContain("PRIVATE NEGOTIATOR MEMORY");
    expect(withoutField.captured[0][0].content).not.toContain("{negotiatorMemory}");
  });

  it("never places memory in the user message (context stays in the system prompt)", async () => {
    const agent = new CapturingNegotiator();
    await agent.invoke(negotiatorInput({ memory: memories }));
    const userMessage = agent.captured[0][1].content;
    expect(userMessage).not.toContain("PRIVATE NEGOTIATOR MEMORY");
    expect(userMessage).not.toContain("maximum budget");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Prompt assembly — NegotiationScreener
// ─────────────────────────────────────────────────────────────────────────────

class CapturingScreener extends NegotiationScreener {
  captured: Array<Array<{ role: string; content: string }>> = [];
  protected override async callModel(
    _model: unknown,
    chatMessages: Array<{ role: string; content: string }>,
  ): Promise<unknown> {
    this.captured.push(chatMessages);
    return {
      decision: "reach_out",
      reasoning: "stub",
      evidence: { counterpartyPremiseFit: "fit", intentAlignment: "aligned" },
    };
  }
}

function screenerInput(extra?: Partial<NegotiationScreenerInput>): NegotiationScreenerInput {
  return {
    clientUser: ownUser,
    counterpartyUser: otherUser,
    seedAssessment: { reasoning: "seed", valencyRole: "peer" },
    indexContext: { networkId: "net-1", prompt: "test network" },
    ...extra,
  };
}

describe("NegotiationScreener prompt assembly (P5.3 memory)", () => {
  it("injects the memory section with the memoryHints instruction", async () => {
    const screener = new CapturingScreener();
    await screener.invoke(screenerInput({ memory: memories }));
    const systemPrompt = screener.captured[0][0].content;
    expect(systemPrompt).toContain("PRIVATE NEGOTIATOR MEMORY");
    expect(systemPrompt).toContain("evidence.memoryHints");
  });

  it("keeps the prompt byte-identical when memory is absent or empty", async () => {
    const withoutField = new CapturingScreener();
    await withoutField.invoke(screenerInput());
    const withEmpty = new CapturingScreener();
    await withEmpty.invoke(screenerInput({ memory: [] }));

    expect(withEmpty.captured[0][0].content).toBe(withoutField.captured[0][0].content);
    expect(withoutField.captured[0][0].content).not.toContain("PRIVATE NEGOTIATOR MEMORY");
    expect(withoutField.captured[0][0].content).not.toContain("{negotiatorMemory}");
  });
});
