import { describe, expect, test } from "bun:test";

import { NEGOTIATION_MAX_TURNS } from "../negotiation.constants.js";
import { currentRound, decideNegotiationTurn, observeNegotiation, type NegotiationAction, type NegotiationState } from "../negotiation.rules.js";

const A = "initiator";
const B = "responder";

function state(actions: NegotiationAction[], awaitingUserId: string | null): NegotiationState {
  return {
    initiatorUserId: A,
    responderUserId: B,
    awaitingUserId,
    outcome: null,
    settled: false,
    eligible: true,
    turns: actions.map((action, index) => ({ seatUserId: index % 2 === 0 ? A : B, action, message: `turn ${index}` })),
  };
}

/** A full round with no offer to accept: propose, then counters until the limit. */
function fullRound(): NegotiationAction[] {
  return ["propose", ...Array.from({ length: NEGOTIATION_MAX_TURNS - 1 }, () => "counter" as const)];
}

describe("decideNegotiationTurn", () => {
  test("a decline ends the round, not the negotiation", () => {
    const decision = decideNegotiationTurn(state(["propose"], B), B, { action: "decline", message: "Not a fit yet." });
    expect(decision).toEqual({
      ok: true, turnIndex: 1, outcome: null, roundEnded: "declined", awaitingUserId: null, opportunityStatus: "negotiating",
    });
  });

  test("the last turn of a round leaves nobody to move and the pair in talks", () => {
    const decision = decideNegotiationTurn(state(fullRound().slice(0, -1), B), B, { action: "counter", message: "One more question." });
    expect(decision).toMatchObject({ ok: true, outcome: null, roundEnded: "turn_limit", awaitingUserId: null, opportunityStatus: "negotiating" });
  });

  test("only an accept settles", () => {
    const decision = decideNegotiationTurn(state(["propose"], B), B, { action: "accept", message: "Agreed." });
    expect(decision).toMatchObject({ ok: true, outcome: "agreed", roundEnded: null, awaitingUserId: null, opportunityStatus: "pending" });
  });

  test("between rounds nobody may move", () => {
    const paused = state(["propose", "decline"], null);
    expect(decideNegotiationTurn(paused, A, { action: "propose", message: "Again." })).toEqual({ ok: false, rejection: "not_your_turn" });
    expect(decideNegotiationTurn(paused, B, { action: "propose", message: "Again." })).toEqual({ ok: false, rejection: "not_your_turn" });
  });

  test("a resumed seat opens a fresh round: propose is legal, counter and accept are not", () => {
    const resumed = state(["propose", "decline"], B);
    expect(decideNegotiationTurn(resumed, B, { action: "counter", message: "?" })).toEqual({ ok: false, rejection: "counter_is_first" });
    expect(decideNegotiationTurn(resumed, B, { action: "accept", message: "Yes." })).toEqual({ ok: false, rejection: "accept_without_offer" });
    expect(decideNegotiationTurn(resumed, B, { action: "propose", message: "New context." })).toMatchObject({
      ok: true, turnIndex: 2, roundEnded: null, awaitingUserId: A,
    });
  });

  test("a round after a full round gets its own turn limit", () => {
    const resumed = state(fullRound(), A);
    const decision = decideNegotiationTurn(resumed, A, { action: "propose", message: "New context." });
    expect(decision).toMatchObject({ ok: true, turnIndex: NEGOTIATION_MAX_TURNS, roundEnded: null, awaitingUserId: B });
  });
});

describe("currentRound", () => {
  test("starts after the last decline or full round", () => {
    expect(currentRound(state(["propose", "counter"], A).turns)).toHaveLength(2);
    expect(currentRound(state(["propose", "decline"], null).turns)).toHaveLength(0);
    expect(currentRound(state(["propose", "decline", "propose"], null).turns)).toHaveLength(1);
    expect(currentRound(state([...fullRound(), "propose"], null).turns)).toHaveLength(1);
  });
});

describe("observeNegotiation", () => {
  test("counts remaining turns per round", () => {
    expect(observeNegotiation(state(["propose", "decline"], A), A)).toMatchObject({
      availableActions: ["propose", "decline"], blockedReason: null, remainingTurns: NEGOTIATION_MAX_TURNS,
    });
    expect(observeNegotiation(state(["propose", "decline", "propose"], B), B)).toMatchObject({
      availableActions: ["counter", "accept", "decline"], remainingTurns: NEGOTIATION_MAX_TURNS - 1,
    });
  });

  test("between rounds both seats are blocked as not their turn", () => {
    const paused = state(["propose", "decline"], null);
    expect(observeNegotiation(paused, A)).toMatchObject({ availableActions: [], blockedReason: "not_your_turn" });
    expect(observeNegotiation(paused, B)).toMatchObject({ availableActions: [], blockedReason: "not_your_turn" });
  });
});
