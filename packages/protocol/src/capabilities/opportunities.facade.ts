/**
 * Opportunities capability's supported outward contract.
 *
 * The list is curated by responsibility (discovery, lifecycle, presentation,
 * and question lenses) rather than exposing the opportunity directory.
 *
 * IND-551: canonical paths updated to opportunity/domain and
 * opportunity/application; shims remain at old flat paths for compatibility.
 */

// ── Core graphs ───────────────────────────────────────────────────────────────
export { RadarGraphFactory } from "../opportunity/radar/radar.graph.js";
export { OpportunityGraphFactory } from "../opportunity/application/opportunity.graph.js";
export type { StampNewbornOpportunitiesFn, StampNewbornOpportunitiesInput } from "../opportunity/application/opportunity.newborn-stamping.js";

// ── Presentation safety ───────────────────────────────────────────────────────
export { hasUnsupportedOpportunityClaim, stripUnsupportedOpportunityClaims } from "../opportunity/domain/opportunity.claim-safety.js";

// ── Evidence ──────────────────────────────────────────────────────────────────
export { buildCandidateEvidence } from "../opportunity/domain/opportunity.evidence.js";

// ── LLM agents ────────────────────────────────────────────────────────────────
export { OpportunityEvaluator } from "../opportunity/application/opportunity.evaluator.js";
export type { EvaluatorInput } from "../opportunity/application/opportunity.evaluator.js";
export { OpportunityPresenter, gatherPresenterContext } from "../opportunity/application/opportunity.presenter.js";
export type { PresenterDatabase } from "../opportunity/application/opportunity.presenter.js";

// ── MCP tool factory ──────────────────────────────────────────────────────────
export { createOpportunityTools } from "../opportunity/application/opportunity.tools.js";
export type { OpportunityToolDeps } from "./opportunities.tools.port.js";

// ── Discovery env accessors ───────────────────────────────────────────────────
export {
  DISCOVERY_EVALUATOR_MIN_SCORE_DEFAULT,
  DISCOVERY_MIN_SIMILARITY_DEFAULT,
  discoveryAllowedTypes,
  discoveryEvaluatorMinScore,
  discoveryIntentMatchingEnabled,
  discoveryMinSimilarity,
  discoveryProfileMatchingEnabled,
  discoveryProfileSource,
  resetDiscoveryEnvWarningsForTests,
  validateDiscoveryEvaluatorMinScore,
  validateDiscoveryMinSimilarity,
} from "../opportunity/discovery.env.js";
export type { DiscoveryMatchType, DiscoveryProfileSource } from "../opportunity/discovery.env.js";

// ── Pool discriminator (Lens A) ───────────────────────────────────────────────
export { PoolDiscriminatorMiner } from "../opportunity/discriminator/discriminator.miner.js";
export { PoolDiscriminatorAssigner } from "../opportunity/discriminator/discriminator.assigner.js";
export type { PoolDiscriminatorAssignmentInput, PoolDiscriminatorAssignedAxis } from "../opportunity/discriminator/discriminator.assigner.js";
export { runPoolDiscriminatorShadow } from "../opportunity/discriminator/discriminator.shadow.js";
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
} from "../opportunity/discriminator/discriminator.env.js";
export { buildPoolAdjustment, planPoolAdjustments, mergePoolAdjustment } from "../opportunity/discriminator/discriminator.adjustments.js";
export type { PoolAdjustment, PoolAdjustmentSignal } from "../opportunity/discriminator/discriminator.adjustments.js";
export { synthesizePoolQuestion, selectQuestionDiscriminators, toQuestionDiscriminator, BOTH_MATTER_LABEL } from "../opportunity/discriminator/discriminator.question.js";
export { poolQuestionCycleKey, buildPoolQuestionPushMessage } from "../opportunity/discriminator/discriminator.push.js";
export type { PoolCandidate, DiscriminatorMiningInput, MinedDiscriminator } from "../opportunity/discriminator/discriminator.types.js";

// ── Negotiation evidence (Lens C) ─────────────────────────────────────────────
export { negotiationEvidenceQuestionsMode, NEGOTIATION_EVIDENCE_MAX_OPPORTUNITIES } from "../opportunity/negotiation-evidence/negotiation-evidence.env.js";
export { NegotiationEvidenceMiner } from "../opportunity/negotiation-evidence/negotiation-evidence.miner.js";
export { runNegotiationEvidenceShadow } from "../opportunity/negotiation-evidence/negotiation-evidence.shadow.js";
export type { RawEvidenceTurn, RawEvidenceOutcome, RawEvidenceOwnerAnswer, RawEvidenceSegment } from "../opportunity/negotiation-evidence/negotiation-evidence.types.js";

// ── Outcome (Lens B) ──────────────────────────────────────────────────────────
export { isOutcomeQuestionsActivated, OUTCOME_MIN_INDEPENDENT_EXAMPLES, OUTCOME_MAX_CANDIDATES, OUTCOME_MAX_PUBLIC_CONTEXT_CHARS } from "../opportunity/outcome/outcome.env.js";
export { runOutcomeShadow } from "../opportunity/outcome/outcome.shadow.js";
export type { OutcomeLabel, OutcomeExample, OutcomeShadowResult } from "../opportunity/outcome/outcome.types.js";

// ── Domain predicates and feed algorithms ─────────────────────────────────────
export { canUserSeeOpportunity, isActionableForViewer, validateOpportunityActors, classifyOpportunity, selectByComposition, RADAR_SOFT_TARGETS } from "../opportunity/domain/opportunity.utils.js";
export { getPrimaryActionLabel } from "../opportunity/domain/opportunity.labels.js";
export { computeRadarHealth } from "../opportunity/radar/radar.health.js";
export type { RadarHealthInput } from "../opportunity/radar/radar.health.js";

// ── Introducer / ambient discovery ───────────────────────────────────────────
export { isIntroducerDiscoveryEnabled } from "../opportunity/application/opportunity.introducer-feature.js";
export { selectContactsForDiscovery, shouldRunIntroducerDiscovery, runIntroducerDiscovery, MAX_CONTACTS_PER_CYCLE, MAX_CANDIDATES_PER_CONTACT, INTRODUCER_DISCOVERY_SOURCE } from "../opportunity/application/opportunity.introducer.js";
export type { IntroducerDiscoveryDatabase, IntroducerDiscoveryQueue, ContactWithIntents } from "../opportunity/application/opportunity.introducer.js";

// ── Persistence ───────────────────────────────────────────────────────────────
export { persistOpportunities } from "../opportunity/application/opportunity.persist.js";

// ── Owner-approval boundary (IND-593) ─────────────────────────────────
export { opportunityOwnerActionForStatus } from "../opportunity/application/opportunity.owner-approval.js";
export { bindOwnerApprovalProvenance } from "../opportunity/application/opportunity.owner-provenance.js";
export type {
  OpportunityOwnerAction,
  OpportunityOwnerApprovalAttestation,
  OpportunityOwnerApprovalAuthority,
  OpportunityOwnerApprovalBinding,
  OpportunityOwnerApprovalChallenge,
  OpportunityOwnerApprovalDenialReason,
  OpportunityOwnerApprovalVerdict,
  OpportunityOwnerInteractionProvenance,
  OpportunityOwnerInteractionSurface,
} from "../opportunity/application/opportunity.owner-approval.js";

// ── Presentation utilities ────────────────────────────────────────────────────
export { presentOpportunity, stripUuids, truncateAtBoundary } from "../opportunity/domain/opportunity.presentation.js";
export type { UserInfo } from "../opportunity/domain/opportunity.presentation.js";
export { stripUnsupportedOpportunityClaims as stripUnsupportedOpportunityClaimsText } from "../opportunity/domain/opportunity.claim-safety.js";
export { safeFallbackSummary, DEFAULT_FALLBACK_HEADLINE } from "../opportunity/domain/opportunity.safe-presentation.js";
export { buildApiChatCardPresentationCacheKey, buildDeliveryCardPresentationCacheKey, buildRadarCardPresentationCacheKey } from "../opportunity/domain/opportunity.presentation-cache.js";
export { getOrCreateDeliveryCardBatch } from "../opportunity/application/delivery-card.cache.js";
