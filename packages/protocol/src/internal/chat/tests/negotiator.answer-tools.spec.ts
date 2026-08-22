/**
 * #1466 — the negotiator's `answer_pending_question` tool and the open-question
 * section it acts on.
 *
 * This is the LONG TAIL of answer routing, not its spine: a reply that plainly
 * answers an open question is routed by the answer evaluator before this
 * persona runs at all. What is pinned here is that the persona can route an
 * oblique or late one EXPLICITLY — and that it is told, in the same breath,
 * not to rewrite the client's signal from a message that answers a question.
 * That substitution is what happened on 2026-08-20, when the persona's only
 * available move on such a message was to edit the signal.
 *
 * The tool sees positions, never ids: the mapping onto negotiation refs lives
 * on the host, for the same reason the answer router never sees one.
 */
import { describe, expect, it } from "bun:test";

import { createNegotiatorAnswerTools } from "../negotiator.tools.js";
import { buildNegotiatorSystemContent } from "../negotiator.prompt.js";
import type { NegotiatorAnswerRoutingResult, NegotiatorAnswerToolsHost } from "../../../platform/negotiation/answer.js";
import type { ResolvedToolContext } from "../../shared/agent/tool.factory.js";

const AGENT_OPTS = { agentName: "Alice's Negotiator" };

function makeCtx(overrides: Partial<ResolvedToolContext> = {}): ResolvedToolContext {
  return {
    userId: "user-1",
    userName: "Alice Test",
    userEmail: "alice@example.com",
    user: { id: "user-1", name: "Alice Test", email: "alice@example.com" },
    userProfile: null,
    userNetworks: [],
    isOwner: false,
    isOnboarding: false,
    hasName: true,
    ...overrides,
  } as unknown as ResolvedToolContext;
}

const pinnedCtx = makeCtx({ scopeType: "intent", scopeId: "intent-42" } as Partial<ResolvedToolContext>);

function makeHost(result: NegotiatorAnswerRoutingResult): {
  host: NegotiatorAnswerToolsHost;
  calls: Array<{ userId: string; input: { intentId: string; question: number; answer: string } }>;
} {
  const calls: Array<{ userId: string; input: { intentId: string; question: number; answer: string } }> = [];
  return {
    calls,
    host: {
      answerOpenQuestion: async (userId, input) => {
        calls.push({ userId, input });
        return result;
      },
    },
  };
}

const invoke = async (tool: { invoke: (input: unknown) => Promise<unknown> }, input: unknown) =>
  JSON.parse(String(await tool.invoke(input))) as Record<string, unknown>;

describe("createNegotiatorAnswerTools", () => {
  it("routes a position and the client's own words to the host, bound to the pinned signal", async () => {
    const { host, calls } = makeHost({ status: "routed", label: "Timing: This week" });
    const [answer] = createNegotiatorAnswerTools({ host, userId: "user-1", intentId: "intent-42" });

    const result = await invoke(answer as never, { question: 1, answer: "This month." });

    expect(calls).toEqual([{
      userId: "user-1",
      input: { intentId: "intent-42", question: 1, answer: "This month." },
    }]);
    expect(result.status).toBe("routed");
    expect(result.question).toBe("Timing: This week");
    // The confirmation it is told to give must not become a signal edit.
    expect(String(result.message)).toContain("do not also change their signal");
  });

  it("tells the client honestly when nothing is open any more", async () => {
    const { host } = makeHost({ status: "no_open_question" });
    const [answer] = createNegotiatorAnswerTools({ host, userId: "user-1", intentId: "intent-42" });

    const result = await invoke(answer as never, { question: 1, answer: "This month." });

    expect(result.status).toBe("no_open_question");
    expect(String(result.message)).toContain("rather than implying their answer was recorded");
  });

  it("hands back the open count when the position names no open question", async () => {
    const { host } = makeHost({ status: "unknown_question", open: 2 });
    const [answer] = createNegotiatorAnswerTools({ host, userId: "user-1", intentId: "intent-42" });

    const result = await invoke(answer as never, { question: 7, answer: "Yes." });

    expect(result).toMatchObject({ status: "unknown_question", open: 2 });
  });

  it("never throws when the host does — the client keeps their turn", async () => {
    const host: NegotiatorAnswerToolsHost = {
      answerOpenQuestion: async () => { throw new Error("queue unavailable"); },
    };
    const [answer] = createNegotiatorAnswerTools({ host, userId: "user-1", intentId: "intent-42" });

    const result = await invoke(answer as never, { question: 1, answer: "This month." });

    expect(result.status).toBe("error");
  });
});

describe("buildNegotiatorSystemContent — open questions in a pinned signal", () => {
  it("names each open question by the number the tool takes", () => {
    const prompt = buildNegotiatorSystemContent(pinnedCtx, {
      ...AGENT_OPTS,
      openQuestions: ["Timing: This week", "Budget"],
    });

    expect(prompt).toContain("## An open question is waiting on Alice Test");
    expect(prompt).toContain("1. “Timing: This week”");
    expect(prompt).toContain("2. “Budget”");
    expect(prompt).toContain("answer_pending_question");
  });

  it("forbids editing the signal from a message that answers an open question", () => {
    const prompt = buildNegotiatorSystemContent(pinnedCtx, {
      ...AGENT_OPTS,
      openQuestions: ["Timing: This week"],
    });

    expect(prompt).toContain("An answer is not a change of signal");
    expect(prompt).toContain("route the answer first");
  });

  it("says nothing about the tool when no question is open — the prompt is unchanged", () => {
    const withNone = buildNegotiatorSystemContent(pinnedCtx, AGENT_OPTS);
    const withEmpty = buildNegotiatorSystemContent(pinnedCtx, { ...AGENT_OPTS, openQuestions: [] });

    expect(withNone).not.toContain("answer_pending_question");
    expect(withNone).not.toContain("An open question is waiting");
    expect(withEmpty).toBe(withNone);
  });

  it("says nothing about the tool outside a pinned signal — the tool is not registered there", () => {
    const unscoped = buildNegotiatorSystemContent(makeCtx(), {
      ...AGENT_OPTS,
      openQuestions: ["Timing: This week"],
    });

    expect(unscoped).not.toContain("answer_pending_question");
    expect(unscoped).toContain("## Open questions");
  });
});
