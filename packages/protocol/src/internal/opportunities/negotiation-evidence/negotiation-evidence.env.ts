/**
 * Centralized accessor + constants for the Lens C negotiation-evidence
 * question producer (IND-433).
 *
 *   Mode: shadow | on — shadow today.
 *     - shadow: mine + verify neutral hypotheses over allowlisted
 *       negotiation evidence, emit AGGREGATE telemetry only. Persists no
 *       questions and changes no ranking, intent, premise, memory, policy,
 *       newborn-stamping, or push behavior.
 *     - on (future, IND-437): additionally synthesize/enqueue questions and
 *       suppress the older IND-296–299 transcript-question producer.
 *
 * All reads go through this module.
 */

/** Documented modes for the Lens C negotiation-evidence question producer. */
export const NEGOTIATION_EVIDENCE_QUESTIONS_MODES = ["shadow", "on"] as const;

/** Mode for the Lens C negotiation-evidence question producer. */
export type NegotiationEvidenceQuestionsMode = (typeof NEGOTIATION_EVIDENCE_QUESTIONS_MODES)[number];

/**
 * The lens runs in shadow: mine + verify, emit aggregate telemetry only. `on`
 * stays in the type as the reserved next step (IND-438), which additionally
 * synthesizes and enqueues questions.
 */
export const NEGOTIATION_EVIDENCE_QUESTIONS_MODE: NegotiationEvidenceQuestionsMode = "shadow";

/**
 * Recurrence floor: a mined hypothesis is only retained when its verified
 * support spans at least this many DISTINCT opportunities (IND-433 `k=5`).
 * Continuation segments of one opportunity are grouped and count once, so this
 * is genuinely a cross-opportunity threshold — same-pair repetition cannot
 * inflate it.
 */
export const NEGOTIATION_EVIDENCE_MIN_DISTINCT_OPPORTUNITIES = 5;

/**
 * Max opportunities (already grouped, one per opportunity) whose allowlisted
 * evidence is sent to the miner in one pass. Bounds prompt size the same way
 * the Lens A miner caps its candidate pool.
 */
export const NEGOTIATION_EVIDENCE_MAX_OPPORTUNITIES = 24;

/** Max chars of allowlisted evidence content retained per evidence unit. */
export const NEGOTIATION_EVIDENCE_MAX_CONTENT_CHARS = 400;
