import db from '../db';
import { indexLinks, intents, intentIndexes, userIntegrations } from '../schema';
import { eq, and, isNull } from 'drizzle-orm';
import { processFilesToIntents, getExistingIntents } from './process-intents';
import { crawlLinksForIndex } from '../crawl/web_crawler';
import { log } from '../log';
import { handlers } from '../integrations';

export type SyncProviderName = 'links' | 'gmail' | 'notion' | 'slack' | 'discord' | 'calendar';

export interface SyncProvider<Params extends Record<string, any> = any> {
  name: SyncProviderName;
  start(run: any, params: Params, update: (patch: any) => Promise<void>): Promise<void>;
}

type LinksParams = { count?: number; skipBrokers?: boolean; all?: boolean; indexId?: string; linkId?: string };

export const linksProvider: SyncProvider<LinksParams> = {
  name: 'links',
  async start(run, params, update) {

    let links: typeof indexLinks.$inferSelect[];
    
    // Handle single link sync
    if (params.linkId) {
      const singleLink = await db.select().from(indexLinks)
        .where(and(eq(indexLinks.userId, run.userId), eq(indexLinks.id, params.linkId)))
        .limit(1);
      if (singleLink.length === 0) {
        await update({ stats: { filesImported: 0, intentsGenerated: 0, links: 0, pagesVisited: 0, note: 'link-not-found' } });
        return;
      }
      links = singleLink;
    } else {
      // Handle multiple links sync
      const allLinks = await db.select().from(indexLinks).where(eq(indexLinks.userId, run.userId));
      if (allLinks.length === 0) {
        await update({ stats: { filesImported: 0, intentsGenerated: 0, links: 0, pagesVisited: 0 } });
        return;
      }
      const processAll = params.all === true;
      links = processAll ? allLinks : allLinks.filter(l => !l.lastSyncAt);
      if (links.length === 0) {
        await update({ stats: { filesImported: 0, intentsGenerated: 0, links: 0, pagesVisited: 0, note: processAll ? 'nothing-to-do' : 'no-new-links' } });
        return;
      }
    }

    const urls = links.map(l => l.url);
    const byUrl = new Map(links.map(l => [l.url, l] as const));
    const normalize = (u: string) => {
      try {
        const x = new URL(u);
        const host = x.hostname.toLowerCase();
        const pathname = x.pathname.replace(/\/+$/, '');
        return `${x.protocol}//${host}${pathname || ''}`;
      } catch {
        return u;
      }
    };
    const byNorm = new Map(links.map(l => [normalize(l.url), l] as const));
    const startedAt = Date.now();
    await update({ progress: { total: urls.length, completed: 0, notes: [`starting crawl (${urls.length} urls)`] } });

    const crawl = await crawlLinksForIndex(urls);

    const userId = run.userId;
    
    // If an indexId is provided, dedupe only against intents already in that index.
    const existingIntentRows = params.indexId
      ? await db
          .select({ payload: intents.payload })
          .from(intents)
          .innerJoin(intentIndexes, eq(intents.id, intentIndexes.intentId))
          .where(and(eq(intentIndexes.indexId, params.indexId), eq(intents.userId, userId), isNull(intents.archivedAt)))
      : await db
          .select({ payload: intents.payload })
          .from(intents)
          .where(and(eq(intents.userId, userId), isNull(intents.archivedAt)));
    const existingIntents = new Set(existingIntentRows.map(r => r.payload));

    let intentsGenerated = 0;
    let filesImported = 0;
    let skippedUnchanged = 0;

    // Prepare files with per-file sourceId for batch processing
    const filesToProcess = crawl.files.map(f => {
      const meta = crawl.urlMap[f.id];
      if (!meta) return null;
      const linkRow = byUrl.get(meta.url) || byNorm.get(normalize(meta.url));
      return {
        id: f.id,
        name: meta.url,
        content: f.content,
        lastModified: new Date(),
        type: 'text/markdown',
        size: f.content.length,
        sourceId: linkRow?.id,
      };
    }).filter(f => f !== null);

    if (filesToProcess.length > 0) {
      const result = await processFilesToIntents({
        userId,
        indexId: params.indexId,
        files: filesToProcess,
        sourceType: 'link',
        perFileMode: true, // Use per-file mode for individual sourceId support
        existingIntents,
        onProgress: async (completed, total, note) => {
          await update({ progress: { completed, total, notes: note ? [note] : [] } });
        },
      });
      
      intentsGenerated = result.intentsGenerated;
      filesImported = result.filesImported;
    }

    const finishedAt = Date.now();
    const statusText = `ok: pages=${crawl.pagesVisited} files=${filesImported} intents=${intentsGenerated} skipped=${skippedUnchanged} duration=${finishedAt - startedAt}ms`;
    for (const l of links) {
      await db.update(indexLinks)
        .set({ lastSyncAt: new Date(), lastStatus: statusText, lastError: null })
        .where(eq(indexLinks.id, l.id));
    }

    log.info('links-sync-run', { runId: run.id, pagesVisited: crawl.pagesVisited, filesImported, intentsGenerated, durationMs: finishedAt - startedAt });
    await update({ stats: { filesImported, intentsGenerated, links: links.length, pagesVisited: crawl.pagesVisited } });
  },
};

type IntegrationType = 'notion' | 'gmail' | 'slack' | 'discord' | 'calendar';
type IntegrationParams = { indexId?: string };

async function getConnectedIntegration(userId: string, integrationType: IntegrationType) {
  const rows = await db
    .select()
    .from(userIntegrations)
    .where(
      and(
        eq(userIntegrations.userId, userId),
        eq(userIntegrations.integrationType, integrationType),
        eq(userIntegrations.status, 'connected'),
        isNull(userIntegrations.deletedAt)
      )
    )
    .limit(1);
  return rows[0] || null;
}

export function createIntegrationProvider(type: IntegrationType): SyncProvider<IntegrationParams> {
  return {
    name: type,
    async start(run, params, update) {
      const integrationRec = await getConnectedIntegration(run.userId, type);
      if (!integrationRec) throw new Error('Integration not connected');

      const handler = handlers[type];
      if (!handler) throw new Error('Unsupported integration type');

      const lastSyncAt = integrationRec.lastSyncAt || undefined;

      await update({ progress: { notes: [`fetching ${type} files`] } });
      const files = await handler.fetchFiles(run.userId, lastSyncAt || undefined);
      await update({ progress: { total: files.length, completed: 0, notes: [`fetched ${files.length} files`] } });

      const { intentsGenerated, filesImported } = await processFilesToIntents({
        userId: run.userId,
        indexId: params.indexId,
        files,
        sourceId: integrationRec.id,
        sourceType: 'integration',
        onProgress: async (completed, total, note) => {
          await update({ progress: { total, completed, notes: note ? [note] : [] } });
        },
      });

      const finishedAt = new Date();
      await db
        .update(userIntegrations)
        .set({ lastSyncAt: finishedAt })
        .where(eq(userIntegrations.id, integrationRec.id));

      log.info(`${type}-sync-run`, { runId: run.id, filesImported, intentsGenerated });
      await update({ stats: { filesImported, intentsGenerated } });
    },
  };
}
