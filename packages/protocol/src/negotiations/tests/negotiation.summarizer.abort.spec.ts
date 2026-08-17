import { config } from "dotenv";
config({ path: ".env.test", override: true });
process.env.OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY ?? "test-key-for-unit-tests";

import { describe, it, expect } from "bun:test";
import { NegotiationSummarizer } from "../negotiation.summarizer.js";
import type { DiscoveryNegotiation } from "../../shared/schemas/discovery-question.schema.js";

function makeSummarizer(
  invokeImpl: (input: unknown, config?: { signal?: AbortSignal }) => Promise<unknown>,
) {
  const s = new NegotiationSummarizer();
  (s as unknown as { model: { invoke: typeof invokeImpl } }).model = { invoke: invokeImpl };
  return s;
}

const baseNegotiation: DiscoveryNegotiation = {
  counterpartyId: "user-bob",
  counterpartyHint: "Senior infra engineer",
  indexContext: "AI infra builders",
  turns: [
    {
      action: "propose",
      reasoning: "Source seeks infra collaborator.",
      suggestedRoles: { ownUser: "peer", otherUser: "peer" },
    },
  ],
  outcome: {
    hasOpportunity: true,
    reasoning: "Clear technical overlap.",
    agreedRoles: [
      { userId: "user-alice", role: "patient" },
      { userId: "user-bob", role: "agent" },
    ],
  },
};

const okDigest = {
  counterpartyHint: "Senior infra engineer",
  indexContext: "AI infra builders",
  outcomeRole: "opportunity",
  outcomeReason: null,
  keyTake: "Clear overlap on retrieval infra; both agreed on patient/agent framing.",
  suggestedRoles: null,
};

describe("NegotiationSummarizer (abort behavior)", () => {
  it("forwards the AbortSignal in the RunnableConfig second arg", async () => {
    let captured: { signal?: AbortSignal } | undefined;
    const s = makeSummarizer(async (_input, cfg) => {
      captured = cfg;
      return okDigest;
    });
    const controller = new AbortController();
    const result = await s.summarize(baseNegotiation, { signal: controller.signal });
    expect(result).not.toBeNull();
    expect(captured?.signal).toBe(controller.signal);
  });

  it("omits config when no signal is passed", async () => {
    let captured: { signal?: AbortSignal } | undefined = { signal: new AbortController().signal };
    const s = makeSummarizer(async (_input, cfg) => {
      captured = cfg;
      return okDigest;
    });
    await s.summarize(baseNegotiation);
    expect(captured).toBeUndefined();
  });

  it("returns null when the in-flight model call rejects after the signal aborts", async () => {
    const controller = new AbortController();
    const s = makeSummarizer(async () => {
      controller.abort(new Error("deadline"));
      const err = new Error("aborted");
      err.name = "AbortError";
      throw err;
    });
    const result = await s.summarize(baseNegotiation, { signal: controller.signal });
    expect(result).toBeNull();
  });
});
