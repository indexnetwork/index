import path from 'path';
import fs from 'fs';
import db from '../../db';
import { indexLinks, intents, intentIndexes } from '../../schema';
import { eq, and } from 'drizzle-orm';
import { analyzeFolder } from '../../../agents/core/intent_inferrer';
import { summarizeIntent } from '../../../agents/core/intent_summarizer';
import { crawlLinksForIndex } from '../../crawl/web_crawler';
import { checkIndexAccess } from '../../index-access';
import { triggerBrokersOnIntentCreated } from '../../../agents/context_brokers/connector';
import { config } from '../../crawl/config';
import { log } from '../../log';
import type { SyncProvider, SyncRun } from '../types';

type Params = { indexId: string; count?: number; skipBrokers?: boolean; all?: boolean };

export const linksProvider: SyncProvider<Params> = {
  name: 'links',
  async start(run: SyncRun, params: Params, update) {
    const { indexId } = params;

    const access = await checkIndexAccess(indexId, run.userId);
    if (!access.hasAccess) throw new Error(access.error || 'No access to index');

    const allLinks = await db.select().from(indexLinks).where(eq(indexLinks.indexId, indexId));
    if (allLinks.length === 0) {
      await update({ stats: { filesImported: 0, intentsGenerated: 0, links: 0, pagesVisited: 0 } });
      return;
    }
    // Process only never-synced links unless 'all' is set
    const processAll = params.all === true;
    const links = processAll ? allLinks : allLinks.filter(l => !l.lastSyncAt);
    if (links.length === 0) {
      await update({ stats: { filesImported: 0, intentsGenerated: 0, links: 0, pagesVisited: 0, note: processAll ? 'nothing-to-do' : 'no-new-links' } });
      return;
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

    // Existing intents for dedupe by payload
    const existingIntentRows = await db.select({ payload: intents.payload })
      .from(intents)
      .innerJoin(intentIndexes, eq(intents.id, intentIndexes.intentId))
      .where(eq(intentIndexes.indexId, indexId));
    const existingPayloads = new Set(existingIntentRows.map(r => r.payload));

    let intentsGenerated = 0;
    let filesImported = 0;
    let skippedUnchanged = 0;

    const baseTempDir = path.join(process.cwd(), 'temp-uploads', `links-${userId}-${Date.now()}`);
    await fs.promises.mkdir(baseTempDir, { recursive: true });
    try {
      let completed = 0;
      for (const f of crawl.files) {
        const meta = crawl.urlMap[f.id];
        if (!meta) continue;
        const linkRow = byUrl.get(meta.url) || byNorm.get(normalize(meta.url));
        if (linkRow && linkRow.lastContentHash && linkRow.lastContentHash === meta.contentHash) {
          skippedUnchanged += 1;
          completed += 1;
          await update({ progress: { total: crawl.files.length, completed, notes: [`skipped unchanged ${completed}/${crawl.files.length}`] } });
          continue;
        }
        const tempDir = path.join(baseTempDir, f.id);
        await fs.promises.mkdir(tempDir, { recursive: true });
        await fs.promises.writeFile(path.join(tempDir, `${f.id}.md`), f.content);
        filesImported += 1;

        const result = await analyzeFolder(
          tempDir,
          [f.id],
          `Generate intents based on content from ${meta.url}`,
          Array.from(existingPayloads),
          [],
          requestedCount,
          60000
        );

        if (result.success && result.intents.length > 0) {
          const intentData = result.intents[0];
          if (!existingPayloads.has(intentData.payload)) {
            const summary = await summarizeIntent(intentData.payload);
            const inserted = await db.insert(intents).values({
              payload: intentData.payload,
              summary: summary || intentData.payload.slice(0, 150),
              userId,
              isIncognito: false,
            }).returning({ id: intents.id });
            const intentId = inserted[0].id;
            await db.insert(intentIndexes).values({ intentId, indexId });
            existingPayloads.add(intentData.payload);
            if (!skipBrokers) {
              triggerBrokersOnIntentCreated(intentId).catch(() => void 0);
            }
            intentsGenerated += 1;
          }
        }
        // Update last content hash for this link if we can map it
        if (linkRow) {
          await db.update(indexLinks).set({ lastContentHash: meta.contentHash }).where(eq(indexLinks.id, linkRow.id));
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

    log.info('links-sync-run', { runId: run.id, indexId, pagesVisited: crawl.pagesVisited, filesImported, intentsGenerated, durationMs: finishedAt - startedAt });
    await update({ stats: { filesImported, intentsGenerated, links: links.length, pagesVisited: crawl.pagesVisited } });
  },
};
