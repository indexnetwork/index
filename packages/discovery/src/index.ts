export { generateEmbeddings, OPENROUTER_EMBEDDING_MODEL, OPENROUTER_EMBEDDING_DIMENSIONS, OPENROUTER_EMBEDDING_BASE_URL } from './core/embedding.generator.js';
export type { EmbeddingClient } from './core/embedding.generator.js';
export { CandidateDiscovery } from './matching/candidate.discovery.js';
export type {
  CandidateDiscoveryData,
  CandidateDiscoveryInput,
  CandidateDiscoveryResult,
  CounterpartyCandidate,
} from './matching/candidate.discovery.js';
export { TypeSafeIntentEvaluator } from './matching/intent.evaluator.js';
export { INTENT_MATCH_MODEL, INTENT_MATCH_REASONING } from './matching/discovery.constants.js';
export type {
  DiscoveryData,
  IntentCandidate,
  IntentPairEvaluator,
  EmbeddingGenerator,
  Profile,
  RunOptions,
  Logger,
  TraceEvent,
  ActiveIntent,
} from './core/types.js';
