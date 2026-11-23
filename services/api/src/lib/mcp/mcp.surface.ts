import { eq } from 'drizzle-orm';

import { oauthApplications } from '../../schemas/database.schema';
import { log } from '../log';

const logger = log.lib.from('mcp/mcp.surface');

/** Client names change on re-registration, not mid-session, so a short cache is safe. */
const CACHE_TTL_MS = 5 * 60 * 1000;
const cache = new Map<string, { surface: 'x' | undefined; expiresAt: number }>();

/** A Grok client fronts a user who lives on X, whatever Grok registers itself as. */
export function isGrokClientName(name: string | null | undefined): boolean {
  return /grok/i.test(name ?? '');
}

/**
 * The social surface the OAuth client's owner lives on, from the client's
 * registered name. Lookup failures are swallowed: the surface only steers
 * link handoff, and resolving it must never break authentication.
 */
export async function oauthClientSurface(clientId: string): Promise<'x' | undefined> {
  const cached = cache.get(clientId);
  if (cached && cached.expiresAt > Date.now()) return cached.surface;
  try {
    // Imported lazily so the pure predicate above stays loadable without a database.
    const { default: db } = await import('../drizzle/drizzle');
    const [row] = await db
      .select({ name: oauthApplications.name })
      .from(oauthApplications)
      .where(eq(oauthApplications.clientId, clientId))
      .limit(1);
    const surface = isGrokClientName(row?.name) ? 'x' as const : undefined;
    cache.set(clientId, { surface, expiresAt: Date.now() + CACHE_TTL_MS });
    return surface;
  } catch (error) {
    logger.warn('OAuth client surface lookup failed', { clientId, error: String(error) });
    return undefined;
  }
}
