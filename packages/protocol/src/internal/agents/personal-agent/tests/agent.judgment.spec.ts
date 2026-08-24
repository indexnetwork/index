import { describe, expect, test } from "bun:test";

import { validateDecidedActs } from "../agent.judgment.js";
import type { PersonalAgentTurnContext } from "../agent.types.js";

/**
 * The validator refuses the impossible and re-decides nothing. What it must
 * NOT do is throw away a whole round trip over one impossible act: the retry
 * sees an identical prompt with no feedback, usually repeats the mistake, and
 * the client's real request — a verdict they asked for in words — silently
 * never happens. One bad act drops, exactly as a malformed chip drops.
 */
function context(overrides: Partial<PersonalAgentTurnContext> = {}): PersonalAgentTurnContext {
  return {
    userId: "alice",
    intentId: "intent-1",
    event: "user_message",
    message: { text: "reject the second one", sessionId: "dm-1", messageId: "m-1" },
    signalText: "Looking for a technical co-founder.",
    matches: [{ opportunityId: "opportunity-1", label: "A match", status: "negotiating" }],
    paused: [
      { negotiationId: "task-1", opportunityId: "opportunity-1", reason: "ready_for_verdict", pausedByUs: true, thread: [] },
      { negotiationId: "task-2", opportunityId: "opportunity-2", reason: "needs_principal", pausedByUs: true, thread: [] },
    ],
    dossier: [],
    recentDm: [],
    recentActs: [],
    ...overrides,
  };
}

describe("validateDecidedActs", () => {
  test("an acts-stage message on a client-message turn drops; the client's verdict still executes", () => {
    const decided = validateDecidedActs({
      acts: [
        { act: "message_user", text: "On it." },
        { act: "reject", negotiation: 2, reasoning: "They asked me to." },
      ],
    }, context());

    expect(decided).toEqual([{ tool: "reject", negotiationId: "task-2", reasoning: "They asked me to." }]);
  });

  test("a number outside the list drops, and its siblings survive", () => {
    const decided = validateDecidedActs({
      acts: [
        { act: "promote", negotiation: 9, reasoning: "Out of range." },
        { act: "note_dossier", text: "Can start in three weeks." },
      ],
    }, context({ event: "all_paused", round: 2 }));

    expect(decided).toEqual([{ tool: "note_dossier", text: "Can start in three weeks." }]);
  });

  test("a list where NOTHING survives is re-decided, not executed as an empty turn", () => {
    expect(validateDecidedActs({ acts: [{ act: "message_user", text: "hi" }] }, context())).toBeNull();
  });

  test("an empty act list is a real answer — the turn decided nothing", () => {
    expect(validateDecidedActs({ acts: [] }, context())).toEqual([]);
  });

  test("asking still blocks acting, after the drops", () => {
    const decided = validateDecidedActs({
      acts: [
        { act: "ask", text: "How soon could you start?" },
        { act: "promote", negotiation: 1, reasoning: "Converged." },
        { act: "note_dossier", text: "Prefers remote." },
      ],
    }, context({ event: "all_paused", round: 2 }));

    expect(decided).toEqual([
      { tool: "ask", text: "How soon could you start?" },
      { tool: "note_dossier", text: "Prefers remote." },
    ]);
  });
});
