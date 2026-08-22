/**
 * Lens B outcome-question mining — shared types (IND-434).
 *
 * Lens B learns whether a user's OWN past explicit opportunity decisions
 * (accept / reject) suggest a useful clarification question, WITHOUT treating
 * mutable statuses, counterparty actions, or system transitions as
 * preferences. It is the historical-outcome analogue of the live-pool Lens A
 * discriminator (see ../discriminator/*).
 *
 * The two lenses share the neutral-axis mining machinery (PoolDiscriminatorMiner
 * assigns candidates to axis sides from presentation-safe context only). Lens B
 * adds the crucial privacy/correctness discipline on top:
 *
 *   1. Candidates are assigned to sides BLIND to their outcome label — the
 *      classifier never sees which side the user chose (the miner input carries
 *      no outcome field at all).
 *   2. Outcome labels are joined only AFTER assignment.
 *   3. Related opportunities are deduplicated (one independent example per
 *      distinct counterpart) before support is counted.
 *   4. Every compared group (side) must clear the independent-support
 *      threshold k, so aggregate telemetry never exposes a small cell.
 *
 * P7 (shadow) uses these types for aggregate-telemetry output only: no
 * questions, ranking, intent, premise, memory, newborn-stamp, or push writes.
 */

import type { MinedDiscriminator } from "../discriminator/discriminator.types.js";

/**
 * The only two explicit owner actions Lens B treats as preference labels.
 * Non-action, delivery, expiry, timeout, merge, cascade, screening, and every
 * counterparty/agent/system transition are deliberately excluded upstream.
 */
export type OutcomeLabel = "accepted" | "rejected";

/**
 * One captured owner-outcome example, as consumed by the mining orchestrator.
 * Built from an append-only feedback event; carries only presentation-safe
 * text plus join/dedup keys — never raw ids, vectors, or model reasoning.
 */
export interface OutcomeExample {
  /**
   * Opportunity id — the join key between blind assignment and outcome label.
   * Never emitted in telemetry.
   */
  opportunityId: string;
  /** Presentation-safe candidate snapshot the miner assigns sides from. */
  publicContext: string;
  /** Explicit owner action. Joined AFTER assignment, never seen by the miner. */
  label: OutcomeLabel;
  /**
   * Related-opportunity dedup key: a stable, non-reversible identifier of the
   * counterpart (or opportunity when no counterpart). Two examples with the
   * same key count as ONE independent example.
   */
  dedupKey: string;
  /** Sort key for recency-based capping/representative selection (ISO-8601). */
  occurredAt: string;
  /** Optional confidence mass for score-weighted assignment; defaults to 1. */
  score?: number;
}

/** Aggregate support for one discriminator side, after dedup + threshold. */
export interface OutcomeSideSupport {
  /** Neutral side label carried verbatim from the miner. */
  side: string;
  /** Distinct independent (deduplicated) examples assigned to this side (≥ k). */
  independentSupport: number;
  /**
   * Independent accepted examples ÷ independentSupport, rounded to 0.01. A
   * rate, never a raw small-cell count.
   */
  acceptRate: number;
}

/** One eligible neutral hypothesis with aggregate-only stats. */
export interface OutcomeHypothesis {
  /** Discriminator label, e.g. "Hands-on builders vs strategic advisors". */
  label: string;
  /** A neutral question the intent owner could answer to resolve the axis. */
  questionSeed: string;
  /** Only the qualified sides (each ≥ k independent examples). */
  sides: OutcomeSideSupport[];
  /** Evidence-verification rate carried from the miner (hallucination health). */
  evidenceRate: number;
  /** Minimum independentSupport across the qualified sides (≥ k). */
  minIndependentSupport: number;
}

/** Result of one shadow mining pass (the aggregate telemetry payload shape). */
export interface OutcomeShadowResult {
  /** Distinct independent examples considered after dedup + capping. */
  poolSize: number;
  /** Count of eligible hypotheses (meets k + ≥ minComparedSides qualified). */
  eligibleCount: number;
  /**
   * Eligible hypotheses only, sorted deterministically. Aggregate stats only —
   * no opportunity ids, no candidate text, no small-cell counts.
   */
  hypotheses: OutcomeHypothesis[];
}

/** Input to the pure outcome-join step (assignment already done, blind). */
export interface JoinOutcomeHypothesesInput {
  /** Mined discriminators with verified side assignments (blind to outcome). */
  discriminators: MinedDiscriminator[];
  /**
   * Outcome labels keyed by opportunity id. Each example is already
   * independent (deduplicated by the orchestrator), so one entry = one
   * independent example.
   */
  examples: Map<string, OutcomeLabel>;
  /** Independent-support threshold per side. Defaults to k. */
  minIndependentSupport?: number;
  /** Minimum qualified sides. Defaults to the module constant. */
  minComparedSides?: number;
}
