/**
 * opportunity/public — curated public surface of the opportunities capability.
 *
 * Re-exports stable contracts from domain, application, and ports.
 * Cross-capability consumers MUST import through this surface or through
 * capabilities/opportunities.facade.ts (which re-exports from here).
 *
 * IND-551: canonical public surface for the opportunities capability.
 */

// ── Domain exports ────────────────────────────────────────────────────────────
export {
  // state
  OpportunityGraphState,
  resolveInitialStatus,
} from "../domain/opportunity.state.js";
export type {
  SourceProfileData,
  IndexedIntent,
  TargetNetwork,
  CandidateMatch,
  EvaluatedCandidate,
  EvaluatedOpportunityActor,
  EvaluatedOpportunity,
  OpportunityPersistenceOutcome,
  OpportunityTrigger,
  OpportunityGraphOptions,
} from "../domain/opportunity.state.js";
export type {
  DiscoverDebugStep,
  DiscoveryResultContract,
} from "../domain/opportunity.discovery.contracts.js";
export {
  MINIMAL_MAIN_TEXT_MAX_CHARS,
  PRIMARY_ACTION_LABEL_INTRODUCER,
  PRIMARY_ACTION_LABEL_DEFAULT,
  SECONDARY_ACTION_LABEL,
  getPrimaryActionLabel,
} from "../domain/opportunity.labels.js";
export {
  deriveRolesFromCorpus,
  validateOpportunityActors,
  canUserSeeOpportunity,
  isActionableForViewer,
  classifyOpportunity,
  selectByComposition,
  deduplicateByPerson,
  selectDigestCandidates,
  FEED_SOFT_TARGETS,
  DIGEST_REDELIVERY_COOLDOWN_DAYS,
} from "../domain/opportunity.utils.js";
export type {
  OpportunityActorRole,
  DerivedRoles,
  FeedCategory,
  DigestDeliveredRow,
} from "../domain/opportunity.utils.js";
export {
  normalizeOpportunityActorIntent,
  resolveOpportunityActorIntent,
  normalizeOpportunityActors,
  normalizeCreateOpportunityActorIntents,
} from "../domain/opportunity.actor.js";
export {
  buildCandidateEvidence,
  mergeOpportunityEvidence,
  withCandidateEvidence,
  withMatchedStrategies,
  renderOpportunityEvidenceForPrompt,
} from "../domain/opportunity.evidence.js";
export type { EvidenceCandidateInput } from "../domain/opportunity.evidence.js";
export {
  hasUnsupportedOpportunityClaim,
  isUnsupportedOpportunityClaimSentence,
  stripUnsupportedOpportunityClaims,
} from "../domain/opportunity.claim-safety.js";
export {
  presentOpportunity,
  stripUuids,
  truncateAtBoundary,
  viewerCentricCardSummary,
  narratorRemarkFromReasoning,
  stripIntroducerMentions,
} from "../domain/opportunity.presentation.js";
export type {
  OpportunityPresentation,
  UserInfo,
} from "../domain/opportunity.presentation.js";
export {
  safeFallbackSummary,
  SAFE_FALLBACK_MAX_CHARS,
  DEFAULT_EMPTY_FALLBACK_TEXT,
} from "../domain/opportunity.safe-presentation.js";
export {
  OPPORTUNITY_PRESENTATION_CACHE_VERSION,
  buildHomeCardPresentationCacheKey,
  buildHomeCategoryPresentationCacheKey,
  buildDeliveryCardPresentationCacheKey,
  buildApiChatCardPresentationCacheKey,
} from "../domain/opportunity.presentation-cache.js";
export {
  buildDiscoverySummary,
  toDiscoveryNegotiation,
} from "../domain/negotiation-summary.builder.js";
export type { NegotiationResolution } from "../domain/negotiation-summary.builder.js";

// discriminator domain
export type {
  PoolCandidate,
  DiscriminatorMiningInput,
  MinedDiscriminator,
  ScoredDiscriminator,
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

// negotiation-evidence domain
export type {
  RawEvidenceTurn,
  RawEvidenceOutcome,
  RawEvidenceOwnerAnswer,
  RawEvidenceSegment,
} from "../negotiation-evidence/negotiation-evidence.types.js";
export {
  negotiationEvidenceQuestionsMode,
  NEGOTIATION_EVIDENCE_MAX_OPPORTUNITIES,
} from "../negotiation-evidence/negotiation-evidence.env.js";

// outcome domain
export type {
  OutcomeLabel,
  OutcomeExample,
  OutcomeShadowResult,
} from "../outcome/outcome.types.js";
export {
  isOutcomeQuestionsActivated,
  OUTCOME_MIN_INDEPENDENT_EXAMPLES,
  OUTCOME_MAX_CANDIDATES,
  OUTCOME_MAX_PUBLIC_CONTEXT_CHARS,
} from "../outcome/outcome.env.js";

// feed domain
export { computeFeedHealth } from "../feed/feed.health.js";
export type { FeedHealthInput } from "../feed/feed.health.js";

// ── Application exports ───────────────────────────────────────────────────────
export { OpportunityGraphFactory } from "../application/opportunity.graph.js";
export type {
  StampNewbornOpportunitiesFn,
  StampNewbornOpportunitiesInput,
} from "../application/opportunity.newborn-stamping.js";
export { OpportunityEvaluator } from "../application/opportunity.evaluator.js";
export type { EvaluatorInput } from "../application/opportunity.evaluator.js";
export {
  OpportunityPresenter,
  gatherPresenterContext,
} from "../application/opportunity.presenter.js";
export type { PresenterDatabase } from "../application/opportunity.presenter.js";
export { persistOpportunities } from "../application/opportunity.persist.js";
export {
  selectContactsForDiscovery,
  shouldRunIntroducerDiscovery,
  runIntroducerDiscovery,
  MAX_CONTACTS_PER_CYCLE,
  MAX_CANDIDATES_PER_CONTACT,
  INTRODUCER_DISCOVERY_SOURCE,
} from "../application/opportunity.introducer.js";
export type {
  IntroducerDiscoveryDatabase,
  IntroducerDiscoveryQueue,
  ContactWithIntents,
} from "../application/opportunity.introducer.js";
export { getOrCreateDeliveryCardBatch } from "../application/delivery-card.cache.js";
export { buildPrioritizedNegotiationIntents } from "../application/opportunity.existing-negotiation.js";

// discriminator application
export { PoolDiscriminatorMiner } from "../discriminator/discriminator.miner.js";
export { PoolDiscriminatorAssigner } from "../discriminator/discriminator.assigner.js";
export type {
  PoolDiscriminatorAssignmentInput,
  PoolDiscriminatorAssignedAxis,
} from "../discriminator/discriminator.assigner.js";
export { runPoolDiscriminatorShadow } from "../discriminator/discriminator.shadow.js";

// negotiation-evidence application
export { NegotiationEvidenceMiner } from "../negotiation-evidence/negotiation-evidence.miner.js";
export { runNegotiationEvidenceShadow } from "../negotiation-evidence/negotiation-evidence.shadow.js";

// outcome application
export { runOutcomeShadow } from "../outcome/outcome.shadow.js";

// feed application
export { HomeGraphFactory } from "../feed/feed.graph.js";

// ── Tools ────────────────────────────────────────────────────────────────────
export { createOpportunityTools } from "../application/opportunity.tools.js";

// ── Ports ─────────────────────────────────────────────────────────────────────
export type { OpportunityToolDeps } from "../ports/index.js";
