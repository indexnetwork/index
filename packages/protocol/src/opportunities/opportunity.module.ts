/**
 * opportunity — the capability's sole cross-capability surface.
 *
 * Anything outside this capability imports from here and nowhere else.
 * Supersedes the capabilities/*.facade.ts + opportunities/public/ pair; the export
 * list is the union of the facades it replaces, so the contract is unchanged.
 */
export {
  getOrCreateDeliveryCardBatch,
} from "./delivery-card.cache.js";
export {
  OpportunityEvaluator,
} from "./opportunity.evaluator.js";
export type {
  EvaluatorInput,
} from "./opportunity.evaluator.js";
export {
  OpportunityGraphFactory,
} from "./opportunity.graph.js";
export type {
  OpportunityGraphThresholdOverrides,
} from "./opportunity.graph.js";
export {
  isIntroducerDiscoveryEnabled,
} from "./opportunity.introducer-feature.js";
export {
  INTRODUCER_DISCOVERY_SOURCE,
  MAX_CANDIDATES_PER_CONTACT,
  MAX_CONTACTS_PER_CYCLE,
  runIntroducerDiscovery,
  selectContactsForDiscovery,
  shouldRunIntroducerDiscovery,
} from "./opportunity.introducer.js";
export type {
  ContactWithIntents,
  IntroducerDiscoveryDatabase,
  IntroducerDiscoveryQueue,
} from "./opportunity.introducer.js";
export type {
  StampNewbornOpportunitiesFn,
  StampNewbornOpportunitiesInput,
} from "./opportunity.newborn-stamping.js";
export {
  opportunityOwnerActionForStatus,
} from "./opportunity.owner-approval.js";
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
} from "./opportunity.owner-approval.js";
export {
  bindOwnerApprovalProvenance,
} from "./opportunity.owner-provenance.js";
export {
  persistOpportunities,
} from "./opportunity.persist.js";
export {
  gatherPresenterContext,
  OpportunityPresenter,
} from "./opportunity.presentation.js";
export type {
  PresenterDatabase,
} from "./opportunity.presentation.js";
export {
  createOpportunityTools,
} from "./opportunity.tools.js";
export {
  createOpportunityVerdictTools,
} from "./opportunity.verdict.tools.js";
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
} from "./discovery.env.js";
export type {
  DiscoveryMatchType,
  DiscoveryProfileSource,
} from "./discovery.env.js";
export {
  buildPoolAdjustment,
  mergePoolAdjustment,
  planPoolAdjustments,
} from "./discriminator/discriminator.adjustments.js";
export type {
  PoolAdjustment,
  PoolAdjustmentSignal,
} from "./discriminator/discriminator.adjustments.js";
export {
  PoolDiscriminatorAssigner,
} from "./discriminator/discriminator.assigner.js";
export type {
  PoolDiscriminatorAssignedAxis,
  PoolDiscriminatorAssignmentInput,
} from "./discriminator/discriminator.assigner.js";
export {
  POOL_DISCRIMINATOR_MAX_CANDIDATES,
  POOL_DISCRIMINATOR_MAX_PUBLIC_CONTEXT_CHARS,
  POOL_DISCRIMINATOR_MIN_POOL_SIZE,
  POOL_QUESTION_MAX_PENDING_PER_INTENT,
  POOL_QUESTION_MIN_VOI,
  POOL_RERUN_DEBOUNCE_MS,
} from "./discriminator/discriminator.env.js";
export {
  PoolDiscriminatorMiner,
} from "./discriminator/discriminator.miner.js";
export {
  buildPoolQuestionPushMessage,
  poolQuestionCycleKey,
} from "./discriminator/discriminator.push.js";
export {
  BOTH_MATTER_LABEL,
  selectQuestionDiscriminators,
  synthesizePoolQuestion,
  toQuestionDiscriminator,
} from "./discriminator/discriminator.question.js";
export {
  runPoolDiscriminatorShadow,
} from "./discriminator/discriminator.shadow.js";
export type {
  DiscriminatorMiningInput,
  MinedDiscriminator,
  PoolCandidate,
} from "./discriminator/discriminator.types.js";
export {
  hasUnsupportedOpportunityClaim,
  stripUnsupportedOpportunityClaims,
  stripUnsupportedOpportunityClaims as stripUnsupportedOpportunityClaimsText,
} from "../shared/utils/claim-safety.js";
export {
  buildCandidateEvidence,
} from "./opportunity.evidence.js";
export {
  getPrimaryActionLabel,
} from "./opportunity.labels.js";
export {
  buildApiChatCardPresentationCacheKey,
  buildDeliveryCardPresentationCacheKey,
  buildRadarCardPresentationCacheKey,
} from "./opportunity.presentation.js";
export {
  presentOpportunity,
  stripUuids,
  truncateAtBoundary,
} from "./opportunity.presentation.js";
export type {
  UserInfo,
} from "./opportunity.presentation.js";
export {
  DEFAULT_FALLBACK_HEADLINE,
  safeFallbackSummary,
} from "./opportunity.presentation.js";
export {
  canUserSeeOpportunity,
  classifyOpportunity,
  isActionableForViewer,
  RADAR_SOFT_TARGETS,
  selectByComposition,
  validateOpportunityActors,
} from "./opportunity.utils.js";
export {
  NEGOTIATION_EVIDENCE_MAX_OPPORTUNITIES,
  NEGOTIATION_EVIDENCE_QUESTIONS_MODE,
} from "./negotiation-evidence/negotiation-evidence.env.js";
export {
  NegotiationEvidenceMiner,
} from "./negotiation-evidence/negotiation-evidence.miner.js";
export {
  runNegotiationEvidenceShadow,
} from "./negotiation-evidence/negotiation-evidence.shadow.js";
export type {
  RawEvidenceOutcome,
  RawEvidenceOwnerAnswer,
  RawEvidenceSegment,
  RawEvidenceTurn,
} from "./negotiation-evidence/negotiation-evidence.types.js";
export {
  isOutcomeQuestionsActivated,
  OUTCOME_MAX_CANDIDATES,
  OUTCOME_MAX_PUBLIC_CONTEXT_CHARS,
  OUTCOME_MIN_INDEPENDENT_EXAMPLES,
} from "./outcome/outcome.env.js";
export {
  runOutcomeShadow,
} from "./outcome/outcome.shadow.js";
export type {
  OutcomeExample,
  OutcomeLabel,
  OutcomeShadowResult,
} from "./outcome/outcome.types.js";
export type {
  OpportunityToolDeps,
} from "./opportunity.tools.port.js";
export {
  RadarGraphFactory,
} from "./radar/radar.graph.js";
export {
  computeRadarHealth,
} from "./radar/radar.health.js";
export type {
  RadarHealthInput,
} from "./radar/radar.health.js";
