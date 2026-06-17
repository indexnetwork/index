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
 * @returns The global context paragraph, or `''` when none exists and none can be built.
 */
export async function ensureGlobalUserContext(userId: string): Promise<string> {
  try {
    const existing = await chatDatabaseAdapter.getUserContext(userId, null);
    if (existing?.text) return existing.text;

    const premises = await chatDatabaseAdapter.getPremisesForUser(userId, 'ACTIVE');
    const contextPremises: ContextPremise[] = premises.map((p) => ({
      id: p.id,
      updatedAt: p.updatedAt,
      assertion: { text: p.assertion.text },
    }));
    const premiseTexts = contextPremises
      .map((p) => ({ text: p.assertion.text }))
      .filter((p) => p.text.length > 0);
    if (premiseTexts.length === 0) return '';

    generator ??= new UserContextGenerator(embedderAdapter);
    const { text, embedding } = await generator.generateGlobalColdStart({ premises: premiseTexts });

    await chatDatabaseAdapter.upsertUserContext({
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
