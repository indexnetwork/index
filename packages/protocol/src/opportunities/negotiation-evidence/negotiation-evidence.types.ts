/**
 * Lens C negotiation-evidence — shared types (IND-433).
 *
 * Lens C mines neutral clarification hypotheses from RECURRING negotiation
 * evidence, read in place at mining time. It never builds a durable transcript
 * projection and never summarizes an entire pair DM; the only content it will
 * ever touch is a narrow, positively-constructed allowlist:
 *
 *   - authoritative owner answers (the recipient's own answers),
 *   - structured bilateral actions / coarse outcomes, and
 *   - explicitly shared message content.
 *
 * Everything else — screen/evaluator reasoning, agent chain-of-thought,
 * `memoryHints`, private negotiator memories/reflections, disclosure subjects,
 * untagged shared answers, and old synthesized digests — is excluded by
 * construction (never mapped into an {@link AllowlistedEvidence}).
 */

/** The four allowlisted evidence families. Nothing else may be surfaced. */
export type EvidenceKind =
  | "owner_answer"
  | "bilateral_action"
  | "coarse_outcome"
  | "shared_message";

/**
 * Who authored an evidence unit. `system` covers structured bilateral facts
 * (actions/outcomes) that belong to neither party's voice. The distinction is
 * load-bearing: a counterparty statement may support an OBSERVATION but never
 * a fact or preference ABOUT the recipient (IND-433).
 */
export type EvidenceSpeaker = "owner" | "counterparty" | "system";

/**
 * One unit of allowlisted evidence, extracted in place for exactly one
 * (recipient, intent, opportunity, task) tuple. Provenance travels with the
 * unit so cross-recipient / cross-intent / cross-opportunity / cross-network /
 * cross-task / cross-speaker contamination is a pure-function rejection rather
 * than a downstream concern.
 */
export interface AllowlistedEvidence {
  /** Deterministic id, unique within one mining pass: `${kind}:${opportunityId}:${ordinal}`. */
  evidenceId: string;
  kind: EvidenceKind;
  speaker: EvidenceSpeaker;
  /** The only text a support reference may quote — bounded, exclusion-scrubbed. */
  content: string;
  // Provenance (used for keying + contamination rejection; never sent to the LLM).
  recipientUserId: string;
  intentId: string;
  intentFingerprint: string;
  opportunityId: string;
  taskId: string;
  conversationId: string;
  networkId: string;
}

/**
 * One raw negotiation turn as read in place. Untrusted: it still carries the
 * fields Lens C must EXCLUDE (`reasoning`, `askUser`/disclosure). The extractor
 * maps only the allowlisted projection of this record.
 */
export interface RawEvidenceTurn {
  /** Turn author user id — mapped to owner/counterparty against the segment. */
  senderUserId: string;
  /** Structured bilateral action (propose/accept/counter/decline/...). */
  action: string;
  /** Free-text message body, if any. */
  message?: string | null;
  /**
   * True only when this message was EXPLICITLY shared/consented for reuse.
   * Untagged messages are excluded — Lens C never mines an untagged answer.
   */
  sharedTagged?: boolean;
  /** Chain-of-thought — EXCLUDED. Present here only to prove it is dropped. */
  reasoning?: string | null;
  /** Disclosure subject — EXCLUDED. Present here only to prove it is dropped. */
  disclosureSubject?: string | null;
}

/** Coarse, structured outcome facts (no evaluator reasoning). */
export interface RawEvidenceOutcome {
  hasOpportunity: boolean;
  /** `turn_cap | timeout` are coarse; `screened_out` is a private gate → dropped. */
  reason?: "turn_cap" | "timeout" | "screened_out";
  /** Agreed collaboration roles, if any. */
  agreedRoles?: Array<{ userId: string; role: string }>;
  /** Evaluator reasoning — EXCLUDED. Present here only to prove it is dropped. */
  reasoning?: string | null;
}

/** Authoritative owner answer (the recipient's own answer to a question). */
export interface RawEvidenceOwnerAnswer {
  /** Answerer user id — must equal the segment recipient to be authoritative. */
  answererUserId: string;
  selectedOptions: string[];
  freeText?: string;
}

/**
 * All in-place negotiation data for ONE opportunity segment, scoped to an
 * exact recipient + intent/fingerprint + opportunity + task. Continuations of
 * the same opportunity arrive as separate segments sharing `opportunityId`;
 * the extractor groups them and counts the opportunity once.
 */
export interface RawEvidenceSegment {
  recipientUserId: string;
  intentId: string;
  intentFingerprint: string;
  opportunityId: string;
  taskId: string;
  conversationId: string;
  networkId: string;
  /** The counterparty in this bilateral negotiation. */
  counterpartyUserId: string;
  turns: RawEvidenceTurn[];
  outcome?: RawEvidenceOutcome | null;
  ownerAnswers?: RawEvidenceOwnerAnswer[];
}

/** The scope a mining pass is bound to — every segment must match it exactly. */
export interface EvidenceMiningScope {
  recipientUserId: string;
  intentId: string;
  intentFingerprint: string;
  networkId: string;
}

/**
 * The three claim shapes a hypothesis may take. The speaker constraint is
 * enforced against these: `recipient_fact` / `recipient_preference` require
 * owner-authored (or structured bilateral) support; `observation` may also be
 * supported by counterparty statements.
 */
export type HypothesisClaimType =
  | "observation"
  | "recipient_fact"
  | "recipient_preference";

/** A support reference proposed by the miner (before code-side verification). */
export interface ProposedSupportRef {
  /** Must resolve to an {@link AllowlistedEvidence} in the pass. */
  evidenceId: string;
  /** Verbatim span the miner copied from that evidence's content. */
  span: string;
}

/** One hypothesis proposed by the miner. */
export interface MinedEvidenceHypothesis {
  /** Neutral, non-identifying clarification hypothesis. */
  statement: string;
  claimType: HypothesisClaimType;
  supportRefs: ProposedSupportRef[];
}

/** A support reference that resolved against the allowlist. */
export interface VerifiedSupportRef {
  evidenceId: string;
  kind: EvidenceKind;
  speaker: EvidenceSpeaker;
  opportunityId: string;
}

/**
 * A hypothesis after verification + the recurrence gate. Retained hypotheses
 * are returned for OFFLINE review only — shadow mode never persists or logs
 * their text (see {@link NegotiationEvidenceTelemetry}).
 */
export interface RetainedEvidenceHypothesis {
  statement: string;
  claimType: HypothesisClaimType;
  support: VerifiedSupportRef[];
  /** Count of DISTINCT opportunities in `support` — the recurrence measure. */
  distinctOpportunities: number;
}

/**
 * Aggregate-only telemetry. Deliberately carries NO evidence content, NO
 * hypothesis text, and NO spans — only counts — so it is safe to emit to
 * routine logs without leaking internal negotiation content.
 */
export interface NegotiationEvidenceTelemetry {
  recipientUserId: string;
  intentId: string;
  /** Raw segments supplied to the pass (pre-grouping). */
  segments: number;
  /** Distinct opportunities after continuation grouping. */
  distinctOpportunities: number;
  /** Allowlisted evidence unit counts, by kind. */
  evidenceCounts: Record<EvidenceKind, number>;
  /** Records dropped by allowlist / exclusion / provenance mismatch. */
  excludedRecords: number;
  hypothesesMined: number;
  /** Hypotheses whose every support ref verified against the allowlist. */
  hypothesesSupported: number;
  /** Supported hypotheses that also met the distinct-opportunity floor. */
  hypothesesRecurrent: number;
  /** Hypotheses discarded (unsupported ref, speaker violation, or too rare). */
  hypothesesDiscarded: number;
}

/** Result of one shadow mining pass. */
export interface NegotiationEvidenceShadowResult {
  /** Safe-to-log aggregate counts. */
  telemetry: NegotiationEvidenceTelemetry;
  /**
   * Retained recurrent hypotheses for offline eval. In shadow mode the caller
   * MUST NOT persist these or write them to routine logs.
   */
  hypotheses: RetainedEvidenceHypothesis[];
}
