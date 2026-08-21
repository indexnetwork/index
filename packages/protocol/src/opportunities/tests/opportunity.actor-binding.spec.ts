import { describe, expect, it } from "bun:test";

import { opportunityActorMatchesBinding, resolveOpportunityActorBinding } from "../opportunity.actor.js";

/**
 * How an opportunity actor is bound (checklist plan / ask-user park path).
 *
 * An actor carries EITHER a stated intent or a premise; premise discovery
 * produces the second kind, and in dev it produced most of them. The park's
 * durable coordinates carry the same polymorphism, because the capture used to
 * require an intent and threw "actor binding is ambiguous" for every
 * premise-matched counterparty — which failed the turn and ended the
 * negotiation as a withdrawal. Asking was the one move that could not be made
 * against most of the pool.
 */
describe("resolveOpportunityActorBinding", () => {
  it("reads an intent-bound actor, from either field spelling", () => {
    expect(resolveOpportunityActorBinding({ intent: "i-1" })).toEqual({ kind: "intent", id: "i-1" });
    expect(resolveOpportunityActorBinding({ intentId: "i-1" })).toEqual({ kind: "intent", id: "i-1" });
  });

  it("reads a premise-bound actor", () => {
    expect(resolveOpportunityActorBinding({ premise: "p-1" })).toEqual({ kind: "premise", id: "p-1" });
  });

  it("prefers the premise when an actor carries both keys", () => {
    // A premise-matched actor's `intent` key names the intent it matched
    // against (the recipient's), never its own material. The enricher emits
    // both keys for premise matches, so intent-first resolution bound the
    // counterparty to the recipient's own signal.
    expect(resolveOpportunityActorBinding({ intent: "i-recipient", premise: "p-own" }))
      .toEqual({ kind: "premise", id: "p-own" });
  });

  it("returns undefined for an actor bound by neither", () => {
    expect(resolveOpportunityActorBinding({})).toBeUndefined();
    expect(resolveOpportunityActorBinding({ intent: "   " })).toBeUndefined();
  });
});

describe("opportunityActorMatchesBinding", () => {
  it("matches an actor against the binding of its own kind", () => {
    expect(opportunityActorMatchesBinding({ intent: "i-1" }, { kind: "intent", id: "i-1" })).toBe(true);
    expect(opportunityActorMatchesBinding({ premise: "p-1" }, { kind: "premise", id: "p-1" })).toBe(true);
  });

  it("never matches across kinds, even when the ids collide", () => {
    // The id spaces are separate tables; a premise whose id happened to equal
    // an intent's must not satisfy an intent-bound park.
    expect(opportunityActorMatchesBinding({ premise: "x" }, { kind: "intent", id: "x" })).toBe(false);
    expect(opportunityActorMatchesBinding({ intent: "x" }, { kind: "premise", id: "x" })).toBe(false);
  });

  it("refuses an actor that lost its binding, or a park that carries none", () => {
    expect(opportunityActorMatchesBinding({}, { kind: "intent", id: "i-1" })).toBe(false);
    expect(opportunityActorMatchesBinding({ intent: "i-1" }, undefined)).toBe(false);
  });

  it("matches a dual-key premise-matched actor against its own premise", () => {
    // The incident shape: a premise-matched counterparty carries both keys —
    // `premise` is its own fact, `intent` the recipient's intent it matched
    // against. A correctly stamped premise-kind park must pass this gate.
    expect(opportunityActorMatchesBinding(
      { intent: "i-recipient", premise: "p-own" },
      { kind: "premise", id: "p-own" },
    )).toBe(true);
  });

  it("no longer matches a dual-key actor against its matched-against intent", () => {
    // Deliberate mirror of the premise-first flip: an intent-kind binding
    // naming the recipient's intent is the MIS-stamp this fix eliminates, and
    // the gate stops agreeing with it. Nothing that works today breaks —
    // such parks already fail the claim's counterparty-liveness check first.
    expect(opportunityActorMatchesBinding(
      { intent: "i-recipient", premise: "p-own" },
      { kind: "intent", id: "i-recipient" },
    )).toBe(false);
  });

  it("keeps an intent-only actor matching its own intent binding", () => {
    expect(opportunityActorMatchesBinding({ intent: "i-own" }, { kind: "intent", id: "i-own" })).toBe(true);
    expect(opportunityActorMatchesBinding({ intent: "i-own" }, { kind: "premise", id: "i-own" })).toBe(false);
  });
});
