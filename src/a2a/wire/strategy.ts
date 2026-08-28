import type { DeadlineOptions } from "../../core/deadline.ts";
import type { ActionSpec, Negotiator } from "../../core/negotiator.ts";
import type { NegotiationDecision, NegotiationState } from "../../core/types.ts";
import type { A2AArtifact, A2ATask } from "./types.ts";

/**
 * Decides one turn. Defaults to a plain `negotiator.decide()` call; pass a
 * custom strategy to do something else for a given negotiation domain or
 * personal agent type — e.g. gather extra context first, consult a
 * different model, or call multiple negotiators before settling on one
 * decision. The A2A wire format doesn't change either way.
 *
 * `options` carries the caller's deadline for this turn. Forward it to
 * every call your strategy makes that goes to the network — a strategy
 * that ignores it is exactly as unstoppable as this library was before
 * deadlines existed.
 *
 * It is optional so that both directions stay source-compatible: a
 * three-argument strategy still satisfies this type, and a strategy that
 * composes on top of an exported one can still call it with three
 * arguments. `createA2AHandler()` and `A2ANegotiationClient` always pass
 * it, so an implementation only sees it missing if another strategy
 * dropped it.
 */
export type DecisionStrategy<A extends string> = (
  negotiator: Negotiator,
  state: NegotiationState,
  allowedActions: ActionSpec<A>[],
  options?: DeadlineOptions,
) => Promise<NegotiationDecision<A>>;

export const defaultStrategy: DecisionStrategy<string> = (
  negotiator,
  state,
  allowedActions,
  options,
) => negotiator.decide(state, { allowedActions, ...options });

/** Builds the default strategy with structured terms enabled — see
 * `DecideOptions.terms`. Pass the result as `strategy` on
 * `createA2AHandler()`/`A2ANegotiationClient` so accepting moves name the
 * offer they bind to and `verifyAgreement()` can check them. */
export function strategyWithTerms<A extends string>(terms: string): DecisionStrategy<A> {
  return (negotiator, state, allowedActions, options) =>
    negotiator.decide(state, { allowedActions, terms, ...options });
}

/**
 * Runs after a turn's decision is made. Produces an optional Artifact —
 * structured findings (a score, extracted terms, whatever's useful) kept
 * separate from the negotiation message itself, for a caller like Index
 * Network to extract value from a negotiation without parsing free text.
 * Return null/undefined to attach nothing for this turn.
 */
export type EvaluateHook<A extends string> = (
  task: A2ATask,
  decision: NegotiationDecision<A>,
) => Promise<A2AArtifact | null | undefined> | A2AArtifact | null | undefined;
