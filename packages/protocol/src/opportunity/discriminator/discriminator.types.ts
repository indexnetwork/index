/**
 * Pool discriminator mining — shared types (IND-416 / IND-417).
 *
 * A "pool discriminator" is a preference dimension that splits a discovery-run
 * candidate pool into meaningfully different groups (e.g. "hands-on builders
 * vs advisors"). Discriminators are mined by one structured LLM pass, then
 * scored deterministically (VoI = entropy × coverage^1.5 × novelty) so the
 * highest value question can eventually be asked to the intent owner.
 *
 * Vocabulary note: the LLM wire format (prompt + response schema in the miner)
 * speaks of "axes" with mutually exclusive "sides" — the clearest way to
 * explain the concept to the model. Everything the rest of the codebase
 * touches (types, exports, logs) uses "discriminator".
 *
 * P1 (shadow) uses these types for log-only output; later phases reuse them
 * for question synthesis and answer application.
 */

/** One candidate in the pool as supplied to the miner LLM. */
export interface PoolCandidate {
  /** Opportunity id (stable key for later answer application). */
  id: string;
  /**
   * The exact public-context string shown to the LLM for this candidate
   * (name + bio + matchReason + headline + premise snippets, ≤400 chars).
   * Evidence spans are substring-verified against this exact string.
   */
  publicContext: string;
  /** Candidate confidence/score — the mass used for score-weighted entropy. */
  score: number;
}

/** Input envelope for one mining pass. */
export interface DiscriminatorMiningInput {
  /** Intent payload (+ summary) or ad-hoc search query that produced the pool. */
  intentText: string;
  candidates: PoolCandidate[];
}

/**
 * One candidate assignment on a discriminator, after code-side evidence verification.
 * `side === null` means unknown (LLM abstained, evidence failed verification,
 * or the candidate was missing from the LLM output).
 */
export interface VerifiedAssignment {
  /** Candidate (opportunity) id. */
  id: string;
  /** Verified side label (one of the discriminator's sides), or null = unknown. */
  side: string | null;
  /** The evidence span quoted by the LLM (kept for logging/audit), if any. */
  evidence: string | null;
  /**
   * True when the LLM proposed a side AND its evidence span substring-matched
   * the candidate's publicContext. False for demoted-to-unknown proposals.
   */
  verified: boolean;
}

/** One mined discriminator after evidence verification (pre-scoring). */
export interface MinedDiscriminator {
  /** Short discriminator label, e.g. "Hands-on builders vs strategic advisors". */
  label: string;
  /** A question the intent owner could be asked to resolve the discriminator. */
  questionSeed: string;
  /** 2–3 mutually exclusive side labels. */
  sides: string[];
  /** Exactly one entry per pool candidate. */
  assignments: VerifiedAssignment[];
  /**
   * verified-proposals / total side proposals from the LLM for this discriminator
   * (0 when the LLM proposed no sides at all). The hallucination health metric.
   */
  evidenceRate: number;
}

/** A mined discriminator with its deterministic VoI score components. */
export interface ScoredDiscriminator extends MinedDiscriminator {
  /** Normalized score-weighted entropy over sides, in [0,1]. */
  entropy: number;
  /** Assigned score mass / total pool score mass, in [0,1]. */
  coverage: number;
  /** 1 − max cosine similarity vs reference texts (premises/intent), in [0,1]. */
  novelty: number;
  /** entropy × coverage^1.5 × novelty. */
  voi: number;
}

/** Result of one shadow mining+scoring pass (the log payload shape). */
export interface DiscriminatorShadowResult {
  poolSize: number;
  /** Scored discriminators, sorted by VoI descending. */
  discriminators: ScoredDiscriminator[];
}
