import path from 'path';
import fs from 'fs';
import db from '../db';
import { indexLinks, intents, intentIndexes, userIntegrations } from '../schema';
import { eq, and, isNull } from 'drizzle-orm';
import { analyzeFolder } from '../../agents/core/intent_inferrer';
import { summarizeIntent } from '../../agents/core/intent_summarizer';
import { generateEmbedding } from '../embeddings';
import { crawlLinksForIndex } from '../crawl/web_crawler';
import { Events } from '../events';
import { config } from '../crawl/config';
import { log } from '../log';
import { handlers } from '../integrations';
import { processFilesToIntents } from './process-intents';
import { getTempPath } from '../paths';

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
    const requestedCount = Math.max(1, Math.min(1, params.count ?? 1));
    const skipBrokers = params.skipBrokers === true || !config.linksSync.triggerBrokers;

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

    const baseTempDir = getTempPath('links-temp', `links-${userId}-${Date.now()}`);
    await fs.promises.mkdir(baseTempDir, { recursive: true });
    try {
      let completed = 0;
      for (const f of crawl.files) {
        const meta = crawl.urlMap[f.id];
        if (!meta) continue;
        const linkRow = byUrl.get(meta.url) || byNorm.get(normalize(meta.url));
        const tempDir = path.join(baseTempDir, f.id);
        await fs.promises.mkdir(tempDir, { recursive: true });
        await fs.promises.writeFile(path.join(tempDir, `${f.id}.md`), f.content);
        filesImported += 1;

        const result = await analyzeFolder(
          tempDir,
          [f.id],
          `Generate intents based on content from ${meta.url}`,
          Array.from(existingIntents),
          [],
          requestedCount,
          60000
        );

        if (result.success && result.intents.length > 0) {
          const intentData = result.intents[0];
          if (!existingIntents.has(intentData.payload)) {
            const summary = await summarizeIntent(intentData.payload);
            
            // Generate embedding for semantic search
            let embedding: number[] | null = null;
            try {
              embedding = await generateEmbedding(intentData.payload);
            } catch (error) {
              console.error('Failed to generate embedding:', error);
              // Continue without embedding - it's optional
            }
            
            const inserted = await db.insert(intents).values({
              payload: intentData.payload,
              summary: summary || intentData.payload.slice(0, 150),
              userId,
              isIncognito: false,
              embedding: embedding || undefined,
              sourceId: linkRow?.id,
              sourceType: 'link',
            }).returning({ id: intents.id });
            const intentId = inserted[0].id;
            // Optionally attach to a specific index using the join table.
            if (params.indexId) {
              await db.insert(intentIndexes).values({ intentId, indexId: params.indexId });
            }
            existingIntents.add(intentData.payload);
            if (!skipBrokers) {
              Events.Intent.onCreated({ intentId, userId, payload: intentData.payload }).catch(() => void 0);
            }
            intentsGenerated += 1;
          }
        }
        
        completed += 1;
        await update({ progress: { total: crawl.files.length, completed, notes: [`processed ${completed}/${crawl.files.length}`] } });
      }
    } finally {
      await fs.promises.rm(baseTempDir, { recursive: true, force: true });
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
        textInstruction: `Generate intents based on content from ${type} integration`,
        count: 30,
        summarize: false,
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
