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

  it("prefers the intent when an actor somehow carries both", () => {
    // Intent is the stronger claim: it is what the person stated they want,
    // where a premise is what the system inferred about them.
    expect(resolveOpportunityActorBinding({ intent: "i-1", premise: "p-1" }))
      .toEqual({ kind: "intent", id: "i-1" });
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
});
