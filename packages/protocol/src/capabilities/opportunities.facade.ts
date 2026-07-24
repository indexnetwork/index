/**
 * Opportunities capability's supported outward contract.
 *
 * The list is curated by responsibility (discovery, lifecycle, presentation,
 * and question lenses) rather than exposing the opportunity directory.
 */
export { HomeGraphFactory } from "../opportunity/feed/feed.graph.js";
export { OpportunityGraphFactory } from "../opportunity/opportunity.graph.js";
export type { StampNewbornOpportunitiesFn } from "../opportunity/opportunity.graph.js";
export { hasUnsupportedOpportunityClaim, stripUnsupportedOpportunityClaims } from "../opportunity/opportunity.claim-safety.js";
export { buildCandidateEvidence } from "../opportunity/opportunity.evidence.js";
export { OpportunityEvaluator } from "../opportunity/opportunity.evaluator.js";
export type { EvaluatorInput } from "../opportunity/opportunity.evaluator.js";
export { OpportunityPresenter, gatherPresenterContext } from "../opportunity/opportunity.presenter.js";
export type { PresenterDatabase } from "../opportunity/opportunity.presenter.js";
export { createOpportunityTools } from "../opportunity/opportunity.tools.js";
export {
  PoolDiscriminatorMiner,
} from "../opportunity/discriminator/discriminator.miner.js";
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
export { negotiationEvidenceQuestionsMode, NEGOTIATION_EVIDENCE_MAX_OPPORTUNITIES } from "../opportunity/negotiation-evidence/negotiation-evidence.env.js";
export { NegotiationEvidenceMiner } from "../opportunity/negotiation-evidence/negotiation-evidence.miner.js";
export { runNegotiationEvidenceShadow } from "../opportunity/negotiation-evidence/negotiation-evidence.shadow.js";
export type { RawEvidenceTurn, RawEvidenceOutcome, RawEvidenceOwnerAnswer, RawEvidenceSegment } from "../opportunity/negotiation-evidence/negotiation-evidence.types.js";
export { isOutcomeQuestionsActivated, OUTCOME_MIN_INDEPENDENT_EXAMPLES, OUTCOME_MAX_CANDIDATES, OUTCOME_MAX_PUBLIC_CONTEXT_CHARS } from "../opportunity/outcome/outcome.env.js";
export { runOutcomeShadow } from "../opportunity/outcome/outcome.shadow.js";
export type { OutcomeLabel, OutcomeExample, OutcomeShadowResult } from "../opportunity/outcome/outcome.types.js";
export { canUserSeeOpportunity, isActionableForViewer, validateOpportunityActors, classifyOpportunity, selectByComposition, FEED_SOFT_TARGETS } from "../opportunity/opportunity.utils.js";
export { getPrimaryActionLabel } from "../opportunity/opportunity.labels.js";
export { computeFeedHealth } from "../opportunity/feed/feed.health.js";
export type { FeedHealthInput } from "../opportunity/feed/feed.health.js";
export { selectContactsForDiscovery, shouldRunIntroducerDiscovery, runIntroducerDiscovery, MAX_CONTACTS_PER_CYCLE, MAX_CANDIDATES_PER_CONTACT, INTRODUCER_DISCOVERY_SOURCE } from "../opportunity/opportunity.introducer.js";
export type { IntroducerDiscoveryDatabase, IntroducerDiscoveryQueue, ContactWithIntents } from "../opportunity/opportunity.introducer.js";
export { persistOpportunities } from "../opportunity/opportunity.persist.js";
export { presentOpportunity, stripUuids, truncateAtBoundary } from "../opportunity/opportunity.presentation.js";
export type { UserInfo } from "../opportunity/opportunity.presentation.js";
export { safeFallbackSummary } from "../opportunity/opportunity.safe-presentation.js";
export { buildApiChatCardPresentationCacheKey, buildDeliveryCardPresentationCacheKey, buildHomeCardPresentationCacheKey } from "../opportunity/opportunity.presentation-cache.js";
export { getOrCreateDeliveryCardBatch } from "../opportunity/delivery-card.cache.js";
