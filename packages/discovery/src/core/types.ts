export interface Logger {
  verbose(message: string, meta?: Record<string, unknown>): void;
  debug(message: string, meta?: Record<string, unknown>): void;
  info(message: string, meta?: Record<string, unknown>): void;
  warn(message: string, meta?: Record<string, unknown>): void;
  error(message: string, meta?: Record<string, unknown>): void;
}

export interface TraceEvent {
  type: 'agent_start' | 'agent_end';
  name: string;
  durationMs?: number;
  summary?: string;
}

export interface RunOptions {
  signal?: AbortSignal;
  traceEmitter?: (event: TraceEvent) => void;
  logger?: Logger;
}

export interface EmbeddingGenerator {
  generate(text: string | string[], dimensions?: number, options?: { signal?: AbortSignal }): Promise<number[] | number[][]>;
}

export interface IntentCandidate {
  id: string;
  userId: string;
  networkId: string;
  payload: string;
  summary?: string | null;
}

/** Directly evaluate whether two intents support a mutually useful interaction. */
export interface IntentPairEvaluator {
  /**
   * @param input - The two intent payloads and their shared network context.
   * @param options - Cancellation propagated to the provider.
   * @returns The provider's match probability, a finite number from 0 to 1.
   * @throws When evaluation fails, is cancelled, or returns an invalid probability.
   */
  evaluate(
    input: { intentA: string; intentB: string; networkContext?: string },
    options?: { signal?: AbortSignal },
  ): Promise<number>;
}

export interface ActiveIntent {
  id: string;
  payload: string;
  summary?: string | null;
}

export interface Profile {
  identity?: {
    name?: string;
    bio?: string;
    location?: string;
  };
  context?: string;
}

/** Read ports; the host supplies protocol scope and context permission rules. */
export interface DiscoveryData {
  getNetworkMemberships(userId: string): Promise<Array<{ networkId: string }>>;
  getActiveIntents(userId: string): Promise<ActiveIntent[]>;
  getProfile(userId: string): Promise<Profile | null>;
  getNetworkIdsForIntent(intentId: string): Promise<string[]>;
  getDiscoveryScope(input: {
    userId: string;
    userNetworks: string[];
    networkId?: string;
    networkScope?: string[];
    triggerIntentId?: string;
  }): Promise<{ networkIds: string[]; error?: string }>;
  getActiveNetworkMembershipPairs(pairs: Array<{ userId: string; networkId: string }>): Promise<Array<{ userId: string; networkId: string }>>;
  getNetworkContexts(networkIds: string[]): Promise<Record<string, string>>;
  /**
   * List every other user's active, match-ready intent registered in the requested
   * networks where that user is an active member. Do not rank or limit the results.
   * @param input - The source user to exclude and the authorized network subset.
   * @param options - Cancellation propagated to the host read.
   * @returns Intent payloads with one entry per intent/network registration.
   * @throws When the host read fails or is cancelled.
   */
  listIntentCandidates(
    input: { excludeUserId: string; networkIds: string[] },
    options?: { signal?: AbortSignal },
  ): Promise<IntentCandidate[]>;
}
