/**
 * opportunity/domain — pure types, predicates, policy, and domain contracts.
 *
 * ## What lives here (flat files)
 * - Graph state schema and interfaces (opportunity.state.ts)
 * - Discovery result envelope (opportunity.discovery.contracts.ts)
 * - UI string constants (opportunity.labels.ts)
 * - Core domain predicates and feed algorithms (opportunity.utils.ts)
 * - Actor normalization (opportunity.actor.ts)
 * - Evidence builders and renderers (opportunity.evidence.ts)
 * - Claim-safety guard (opportunity.claim-safety.ts)
 * - Pure presentation transforms (opportunity.presentation.ts)
 * - Safe-presentation pipeline (opportunity.safe-presentation.ts)
 * - Cache key builders (opportunity.presentation-cache.ts)
 * - Discovery-run coalescing (opportunity.discovery-run-coalescing.ts)
 * - Negotiation-summary mappers (negotiation-summary.builder.ts)
 * - Discovery question input helper (discovery-question.helper.ts)
 *
 * ## What lives in subdirectories (exported by path, not moved)
 * - discriminator/ — pool discriminator types, env, scorer, adjustments, question, push
 * - negotiation-evidence/ — evidence types, env, extractor, verifier
 * - outcome/ — outcome types, env, hypotheses
 * - radar/ — radar state schema, radar health scorer
 *
 * IND-551: canonical domain layer for the opportunities capability.
 */

// ── Flat domain files ─────────────────────────────────────────────────────────
export * from "./opportunity.state.js";
export * from "./opportunity.labels.js";
export * from "./opportunity.utils.js";
export * from "./opportunity.actor.js";
export * from "./opportunity.evidence.js";
export * from "./opportunity.claim-safety.js";
export * from "./opportunity.presentation.js";
export * from "./opportunity.safe-presentation.js";
export * from "./opportunity.presentation-cache.js";
export * from "./negotiation-summary.builder.js";
export * from "./discovery-question.helper.js";

// ── Subdirectory domain exports ───────────────────────────────────────────────
// discriminator domain
export type {
  PoolCandidate,
  DiscriminatorMiningInput,
  MinedDiscriminator,
  ScoredDiscriminator,
  VerifiedAssignment,
  DiscriminatorShadowResult,
} from "../discriminator/discriminator.types.js";
export {
  poolQuestionsMiningMode,
  poolQuestionsMode,
  poolQuestionsPushMode,
  poolQuestionsStampNewborn,
  POOL_DISCRIMINATOR_MIN_POOL_SIZE,
  POOL_DISCRIMINATOR_MAX_CANDIDATES,
  POOL_DISCRIMINATOR_MAX_PUBLIC_CONTEXT_CHARS,
  POOL_QUESTION_MIN_VOI,
  POOL_QUESTION_MAX_PENDING_PER_INTENT,
  poolQuestionsRanking,
  POOL_RERUN_DEBOUNCE_MS,
  poolQuestionsVisitTrigger,
  POOL_VISIT_MINING_DEBOUNCE_MS,
} from "../discriminator/discriminator.env.js";
export {
  buildPoolAdjustment,
  planPoolAdjustments,
  mergePoolAdjustment,
  readActivePoolAdjustments,
  adjustedConfidence,
} from "../discriminator/discriminator.adjustments.js";
export type {
  PoolAdjustment,
  PoolAdjustmentSignal,
} from "../discriminator/discriminator.adjustments.js";
export {
  synthesizePoolQuestion,
  selectQuestionDiscriminators,
  toQuestionDiscriminator,
  BOTH_MATTER_LABEL,
} from "../discriminator/discriminator.question.js";
export {
  poolQuestionCycleKey,
  buildPoolQuestionPushMessage,
} from "../discriminator/discriminator.push.js";
export { scoreDiscriminator } from "../discriminator/discriminator.scorer.js";

// negotiation-evidence domain
export type {
  AllowlistedEvidence,
  RawEvidenceSegment,
  RawEvidenceTurn,
  RawEvidenceOutcome,
  RawEvidenceOwnerAnswer,
  NegotiationEvidenceShadowResult,
} from "../negotiation-evidence/negotiation-evidence.types.js";
export {
  negotiationEvidenceQuestionsMode,
  NEGOTIATION_EVIDENCE_MAX_OPPORTUNITIES,
  NEGOTIATION_EVIDENCE_MIN_DISTINCT_OPPORTUNITIES,
  NEGOTIATION_EVIDENCE_MAX_CONTENT_CHARS,
} from "../negotiation-evidence/negotiation-evidence.env.js";
export { extractAllowlistedEvidence } from "../negotiation-evidence/negotiation-evidence.extractor.js";
export { verifyHypotheses } from "../negotiation-evidence/negotiation-evidence.verifier.js";

// outcome domain
export type {
  OutcomeLabel,
  OutcomeExample,
  OutcomeSideSupport,
  OutcomeHypothesis,
  OutcomeShadowResult,
  JoinOutcomeHypothesesInput,
} from "../outcome/outcome.types.js";
export {
  isOutcomeQuestionsActivated,
  OUTCOME_MIN_INDEPENDENT_EXAMPLES,
  OUTCOME_MAX_CANDIDATES,
  OUTCOME_MAX_PUBLIC_CONTEXT_CHARS,
} from "../outcome/outcome.env.js";
export { joinOutcomeHypotheses } from "../outcome/outcome.hypotheses.js";

// radar domain
export { computeRadarHealth } from "../radar/radar.health.js";
export type { RadarHealthResult } from "../radar/radar.health.js";
