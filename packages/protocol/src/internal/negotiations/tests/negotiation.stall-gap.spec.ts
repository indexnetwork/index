import { describe, it, expect } from "bun:test";
import { NegotiationStallGapAuthor, NEGOTIATION_PARK_REASONING, type StallGapAuthorInput } from "../negotiation.stall-gap.js";
import type { NegotiationTurn } from "../negotiation.state.js";

/**
 * Post-stall gap authoring (conversational-questions plan).
 *
 * Pins:
 * - output contract: a gap requires hasGap + question + reason together;
 *   hasGap:false is a first-class "nothing to ask" answer, not an error,
 * - the validate→retry-once→null loop via the `callModel` seam (no provider),
 * - fail-open: a throwing model call resolves to null, never rejects,
 * - prompt grounding: the transcript is rendered; the client-DM section and
 *   its grounding rule appear exactly when an excerpt is supplied,
 * - the park reasoning constant stays fixed, not model-authored.
 */

class ScriptedGapAuthor extends NegotiationStallGapAuthor {
  calls: Array<Array<{ role: string; content: string }>> = [];
  constructor(private outputs: unknown[]) {
    super({ timeoutMs: 1000 });
  }
  protected override async callModel(
    _model: unknown,
    chatMessages: Array<{ role: string; content: string }>,
  ): Promise<unknown> {
    this.calls.push(chatMessages);
    const out = this.outputs[Math.min(this.calls.length - 1, this.outputs.length - 1)];
    if (out instanceof Error) throw out;
    return out;
  }
}

const history: NegotiationTurn[] = [
  {
    action: "propose",
    assessment: { reasoning: "worth exploring", suggestedRoles: { ownUser: "peer", otherUser: "peer" } },
    message: "Shall we collaborate?",
  },
  {
    action: "counter",
    assessment: { reasoning: "timing unclear", suggestedRoles: { ownUser: "peer", otherUser: "peer" } },
    message: "What timeline are you on?",
  },
];

const baseInput: StallGapAuthorInput = {
  userName: "Alice",
  signal: { title: "Build AI", description: "Find an AI collaborator" },
  seedReasoning: "complementary skills",
  history,
  stallReason: "turn_cap",
};

const gapOutput = {
  hasGap: true,
  reason: "unresolved_owner_constraint",
  question: {
    title: "Timing",
    prompt: "When could you realistically start a collaboration?",
    options: [
      { label: "This quarter", description: "The retry will push for an immediate start." },
      { label: "Later this year", description: "The retry will propose a slower ramp-up." },
    ],
    multiSelect: false,
  },
};

describe("NegotiationStallGapAuthor — output contract", () => {
  it("returns the gap when the model reports one with question and reason", async () => {
    const author = new ScriptedGapAuthor([gapOutput]);
    const gap = await author.author(baseInput);
    expect(gap).toEqual({ reason: "unresolved_owner_constraint", question: gapOutput.question });
    expect(author.calls).toHaveLength(1);
  });

  it("returns null without retrying when the model reports no gap", async () => {
    const author = new ScriptedGapAuthor([{ hasGap: false, reason: null, question: null }]);
    expect(await author.author(baseInput)).toBeNull();
    expect(author.calls).toHaveLength(1);
  });

  it("retries once on schema-invalid output, then succeeds", async () => {
    const author = new ScriptedGapAuthor([{ nonsense: true }, gapOutput]);
    const gap = await author.author(baseInput);
    expect(gap?.question.title).toBe("Timing");
    expect(author.calls).toHaveLength(2);
  });

  it("returns null after two invalid attempts", async () => {
    const author = new ScriptedGapAuthor([{ nonsense: true }, { nonsense: true }]);
    expect(await author.author(baseInput)).toBeNull();
    expect(author.calls).toHaveLength(2);
  });

  it("treats a claimed gap without question or reason as invalid (retry, then null)", async () => {
    const author = new ScriptedGapAuthor([{ hasGap: true, reason: null, question: null }]);
    expect(await author.author(baseInput)).toBeNull();
    expect(author.calls).toHaveLength(2);
  });

  it("fails open to null when the model call throws", async () => {
    const author = new ScriptedGapAuthor([new Error("provider down")]);
    expect(await author.author(baseInput)).toBeNull();
  });
});

describe("NegotiationStallGapAuthor — prompt grounding", () => {
  it("renders the transcript, the stall reason, and the user's name", async () => {
    const author = new ScriptedGapAuthor([gapOutput]);
    await author.author(baseInput);
    const [system, user] = author.calls[0];
    expect(system.role).toBe("system");
    expect(system.content).toContain("the turn limit was reached without agreement");
    expect(system.content).toContain("Alice");
    expect(system.content).not.toContain("{userName}");
    expect(user.content).toContain("Turn 1: propose — reasoning: worth exploring — message: Shall we collaborate?");
    expect(user.content).toContain("Turn 2: counter");
    expect(user.content).toContain("Build AI: Find an AI collaborator");
    expect(user.content).toContain("complementary skills");
  });

  it("includes the client-DM section and its grounding rule only when an excerpt is supplied", async () => {
    const without = new ScriptedGapAuthor([gapOutput]);
    await without.author(baseInput);
    expect(without.calls[0][0].content).not.toContain("Do NOT ask what they have already answered");
    expect(without.calls[0][1].content).not.toContain("conversation with Alice about this signal");

    const withDm = new ScriptedGapAuthor([gapOutput]);
    await withDm.author({
      ...baseInput,
      clientDm: [{ role: "client", content: "I only want equity partnerships" }],
    });
    expect(withDm.calls[0][0].content).toContain("Do NOT ask what they have already answered");
    expect(withDm.calls[0][1].content).toContain("conversation with Alice about this signal");
    expect(withDm.calls[0][1].content).toContain("I only want equity partnerships");
  });

  it("labels each stall reason distinctly", async () => {
    for (const [stallReason, label] of [
      ["timeout", "timed out"],
      ["stalled", "stalled without reaching a conclusion"],
    ] as const) {
      const author = new ScriptedGapAuthor([gapOutput]);
      await author.author({ ...baseInput, stallReason });
      expect(author.calls[0][0].content).toContain(label);
    }
  });
});

describe("NEGOTIATION_PARK_REASONING", () => {
  it("is a fixed transcript-safe constant", () => {
    expect(NEGOTIATION_PARK_REASONING).toBe("Negotiation parked pending the client's answer.");
  });
});
