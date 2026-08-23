import { EnrichmentGraphFactory, PremiseGraphFactory } from '@indexnetwork/protocol';
import type { EnrichmentGraphDatabase, PremiseGraphDatabase } from '@indexnetwork/protocol';

import { ChatDatabaseAdapter, EnrichmentDatabaseAdapter } from '../../adapters/database.adapter';
import { ScraperAdapter } from '../../adapters/scraper.adapter';
import { EmbedderAdapter } from '../../adapters/embedder.adapter';
import { log } from '../log';

const logger = log.service.from('CreatePremisesFromProfile');

function buildProfileInputFromUser(
  user: { name?: string | null; intro?: string | null; location?: string | null },
  socials: Array<{ label: string; value: string }>,
): string {
  const lines: string[] = [];
  if (user.name?.trim()) lines.push(`Name: ${user.name.trim()}`);
  if (user.location?.trim()) lines.push(`Location: ${user.location.trim()}`);
  if (user.intro?.trim()) lines.push(user.intro.trim());
  if (socials.length) {
    lines.push(`User-provided public links:\n${socials.map((s) => `${s.label}: ${s.value}`).join('\n')}`);
  }
  return lines.filter((l) => l.trim()).join('\n\n');
}

/** Decompose profile text on the users row into premises (no Parallel prefill). */
export async function createPremisesFromProfile(userId: string): Promise<void> {
  const db: EnrichmentGraphDatabase = new EnrichmentDatabaseAdapter();
  const scraper = new ScraperAdapter();
  const embedder = new EmbedderAdapter();

  const user = await db.getUser(userId);
  if (!user) return;
  const socials = await db.getUserSocials(userId);
  const input = buildProfileInputFromUser(user, socials.map((s) => ({ label: s.label, value: s.value })));
  if (!input.trim()) return;

  const premiseGraph = new PremiseGraphFactory(
    new ChatDatabaseAdapter() as unknown as PremiseGraphDatabase,
    embedder,
  ).createGraph();
  const graph = new EnrichmentGraphFactory(db, scraper, undefined, premiseGraph).createGraph();
  const result = await graph.invoke({ userId, operationMode: 'write', input, forceUpdate: true });
  if (result.error) {
    logger.error('Premise decomposition failed', { userId, error: result.error });
  }
}
