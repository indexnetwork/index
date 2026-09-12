export { Discovery } from './matching/discovery.pipeline.js';
export { DISCOVERY_MIN_SIMILARITY, validateDiscoveryMinSimilarity } from './matching/discovery.constants.js';
export { buildDiscovererContext } from './prompts/discovery.prompt.js';
export type { DiscoveryDeps, DiscoveryInput, DiscoveryState, PotentialIntentPair, SourceProfileData } from './matching/discovery.state.js';
export { MatchExplainer } from './matching/match.explainer.js';
export type { MatchExplainerLike, MatchExplainerInput, MatchExplainerResult, EvaluatorEntity } from './matching/discovery.state.js';
export { ModelClient } from './core/model.js';
export type { Model, ModelRequest, DiscoveryData, CandidateSearch, IntentCandidate, SearchOptions, EmbeddingGenerator, MatchEvidence, RunOptions, Logger, TraceEvent } from './core/types.js';
