import { UserContextGenerator } from '@indexnetwork/protocol';

import { chatDatabaseAdapter } from '../../adapters/database.adapter';
import { embedderAdapter } from '../../adapters/embedder.adapter';
import { log } from '../log';
import { computePremiseHash, type ContextPremise } from './premise-hash';

const logger = log.job.from('GlobalUserContext');

/**
 * Lazily-built, reused generator. `UserContextGenerator` builds an LLM model in its
 * constructor, so one is shared across calls rather than re-created per invocation.
 */
let generator: UserContextGenerator | undefined;

/**
 * Injectable seams for {@link ensureGlobalUserContext}. Each defaults to the
 * production adapter/generator; tests override them to exercise the branches
 * without a live DB or LLM. Mirrors the `UserContextQueueDeps` pattern.
 */
export interface EnsureGlobalUserContextDeps {
  /** Read the stored global context row (networkId null) for the staleness short-circuit. */
  getExistingContext?: (userId: string) => Promise<{ text: string } | null>;
  /** The user's ACTIVE premises (id, updatedAt, assertion text). */
  getActivePremises?: (userId: string) => Promise<ContextPremise[]>;
  /** Synthesize the global (network-agnostic) context paragraph + embedding from premises. */
  generateGlobalContext?: (input: {
    premises: Array<{ text: string }>;
  }) => Promise<{ text: string; embedding: number[] }>;
  /** Upsert the global context row. */
  upsertUserContext?: (params: {
    userId: string;
    networkId: string | null;
    text: string;
    embedding: number[];
    premiseHash: string;
  }) => Promise<{ id: string }>;
}

/**
 * Return the user's **global** `user_context` paragraph (the profile-replacing identity
 * text, `networkId = null`), generating and persisting it on demand when absent.
 *
 * This is the single read path for "Category A" prompt consumers that used to flatten
 * discrete profile fields (`identity`/`narrative`/`attributes`) into LLM prompt text.
 * Resolution order:
 *  1. Return the stored global row's text if present.
 *  2. Otherwise synthesize it from the user's ACTIVE premises via
 *     {@link UserContextGenerator.generateGlobalColdStart}, upsert it (keyed by the
 *     premise staleness hash so the background queue treats it as fresh), and return it.
 *  3. Return `''` only when the user has no usable premises yet (nothing to synthesize).
 *
 * The global row is intentionally excluded from context-to-intent discovery, so no HyDE
 * documents are generated here — the background `UserContextQueue` owns HyDE for the
 * per-network rows. Generation failures are swallowed and reported as an empty string so
 * callers (best-effort prompt enrichment) degrade gracefully rather than throw.
 *
 * @param userId - The user whose global context is needed.
 * @param deps - Optional injectable seams (defaults bind to the production adapters).
 * @returns The global context paragraph, or `''` when none exists and none can be built.
 */
export async function ensureGlobalUserContext(
  userId: string,
  deps?: EnsureGlobalUserContextDeps,
): Promise<string> {
  const getExistingContext =
    deps?.getExistingContext ?? ((id: string) => chatDatabaseAdapter.getUserContext(id, null));
  const getActivePremises =
    deps?.getActivePremises ??
    (async (id: string): Promise<ContextPremise[]> => {
      const premises = await chatDatabaseAdapter.getPremisesForUser(id, 'ACTIVE');
      return premises.map((p) => ({ id: p.id, updatedAt: p.updatedAt, assertion: { text: p.assertion.text } }));
    });
  const generateGlobalContext =
    deps?.generateGlobalContext ??
    ((input: { premises: Array<{ text: string }> }) => {
      generator ??= new UserContextGenerator(embedderAdapter);
      return generator.generateGlobalColdStart(input);
    });
  const upsertUserContext =
    deps?.upsertUserContext ?? chatDatabaseAdapter.upsertUserContext.bind(chatDatabaseAdapter);

  try {
    const existing = await getExistingContext(userId);
    if (existing?.text) return existing.text;

    const contextPremises = await getActivePremises(userId);
    const premiseTexts = contextPremises
      .map((p) => ({ text: p.assertion.text }))
      .filter((p) => p.text.length > 0);
    if (premiseTexts.length === 0) return '';

    const { text, embedding } = await generateGlobalContext({ premises: premiseTexts });

    await upsertUserContext({
      userId,
      networkId: null,
      text,
      embedding,
      premiseHash: computePremiseHash(contextPremises),
    });
    logger.verbose('Generated global user context on demand', { userId });
    return text;
  } catch (err) {
    logger.warn('Failed to ensure global user context, returning empty', { userId, error: err });
    return '';
  }
}
