import { Router, Response } from 'express';
import { body, param, validationResult } from 'express-validator';
import db from '../lib/db';
import { indexLinks, intents, intentIndexes, integrationItems } from '../lib/schema';
import { authenticatePrivy, AuthRequest } from '../middleware/auth';
import { and, desc, eq, isNull } from 'drizzle-orm';
import { checkIndexAccess } from '../lib/index-access';
import { crawlLinksForIndex } from '../lib/crawl/web_crawler';
import path from 'path';
import fs from 'fs';
import { analyzeFolder } from '../agents/core/intent_inferrer';
import { summarizeIntent } from '../agents/core/intent_summarizer';
import { config } from '../lib/config';
import { triggerBrokersOnIntentCreated } from '../agents/context_brokers/connector';

const router = Router({ mergeParams: true });

function isValidUrlCandidate(u: string): boolean {
  try {
    const url = new URL(u);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

// List links for an index
router.get('/',
  authenticatePrivy,
  [param('indexId').isUUID()],
  async (req: AuthRequest, res: Response) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

      const { indexId } = req.params;
      const access = await checkIndexAccess(indexId, req.user!.id);
      if (!access.hasAccess) return res.status(access.status!).json({ error: access.error });

      const links = await db.select().from(indexLinks)
        .where(eq(indexLinks.indexId, indexId))
        .orderBy(desc(indexLinks.createdAt));
      return res.json({ links });
    } catch (err) {
      console.error('List index links error:', err);
      return res.status(500).json({ error: 'Failed to list links' });
    }
  }
);

// Add a link to an index
router.post('/',
  authenticatePrivy,
  [
    param('indexId').isUUID(),
    body('url').isString().trim().isLength({ min: 1 }),
    body('maxDepth').optional().isInt({ min: 0, max: 8 }).toInt(),
    body('maxPages').optional().isInt({ min: 1, max: 1000 }).toInt(),
    body('include').optional().isArray(),
    body('exclude').optional().isArray(),
  ],
  async (req: AuthRequest, res: Response) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

      const { indexId } = req.params;
      const { url, maxDepth = 1, maxPages = 50, include = [], exclude = [] } = req.body;

      const access = await checkIndexAccess(indexId, req.user!.id);
      if (!access.hasAccess) return res.status(access.status!).json({ error: access.error });

      if (!isValidUrlCandidate(url)) return res.status(400).json({ error: 'Invalid URL' });

      const inserted = await db.insert(indexLinks)
        .values({ indexId, url, maxDepth, maxPages, includePatterns: include, excludePatterns: exclude })
        .returning();

      return res.status(201).json({ link: inserted[0] });
    } catch (err) {
      console.error('Create index link error:', err);
      return res.status(500).json({ error: 'Failed to add link' });
    }
  }
);

// Delete a link
router.delete('/:linkId',
  authenticatePrivy,
  [param('indexId').isUUID(), param('linkId').isUUID()],
  async (req: AuthRequest, res: Response) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

      const { indexId, linkId } = req.params;
      const access = await checkIndexAccess(indexId, req.user!.id);
      if (!access.hasAccess) return res.status(access.status!).json({ error: access.error });

      const result = await db.delete(indexLinks)
        .where(and(eq(indexLinks.id, linkId), eq(indexLinks.indexId, indexId)));

      return res.json({ success: true });
    } catch (err) {
      console.error('Delete index link error:', err);
      return res.status(500).json({ error: 'Failed to delete link' });
    }
  }
);

// Sync endpoint (stub): will crawl links, ingest, and generate intents in follow-up commits
router.post('/sync',
  authenticatePrivy,
  [param('indexId').isUUID()],
  async (req: AuthRequest, res: Response) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

      const { indexId } = req.params;
      const access = await checkIndexAccess(indexId, req.user!.id);
      if (!access.hasAccess) return res.status(access.status!).json({ error: access.error });

      const links = await db.select().from(indexLinks).where(eq(indexLinks.indexId, indexId));
      if (links.length === 0) return res.json({ success: true, filesImported: 0, intentsGenerated: 0, links: 0 });

      // Crawl
      const linkConfigs = links.map(l => ({
        url: l.url,
        maxDepth: l.maxDepth,
        maxPages: l.maxPages,
        includePatterns: l.includePatterns,
        excludePatterns: l.excludePatterns,
      }));

      const startedAt = Date.now();
      const crawl = await crawlLinksForIndex(linkConfigs);

      // Per-file processing (1 page -> 1 intent) with dedupe
      const provider = 'web';
      const userId = req.user!.id;
      const requestedCount = Number((req.query as any).count) || 1; // per page, cap to 1
      const skipBrokersQ = ((req.query as any).skipBrokers || '').toString().toLowerCase();
      const skipBrokers = skipBrokersQ === '1' || skipBrokersQ === 'true' || !config.linksSync.triggerBrokers;

      let intentsGenerated = 0;
      let filesImported = 0;

      // Create base temp dir
      const baseTempDir = path.join(process.cwd(), 'temp-uploads', `links-${userId}-${Date.now()}`);
      await fs.promises.mkdir(baseTempDir, { recursive: true });

      for (const f of crawl.files) {
        const meta = crawl.urlMap[f.id];
        if (!meta) continue;
        // Dedupe mapping on URL + user + index
        const existing = await db.select({ id: integrationItems.id, contentHash: integrationItems.contentHash })
          .from(integrationItems)
          .where(and(
            eq(integrationItems.provider, provider),
            eq(integrationItems.externalId, meta.url),
            eq(integrationItems.userId, userId),
            eq(integrationItems.indexId, indexId)
          ));
        if (existing.length > 0 && existing[0].contentHash === meta.contentHash) {
          continue; // unchanged
        }

        // Write one file
        const tempDir = path.join(baseTempDir, f.id);
        await fs.promises.mkdir(tempDir, { recursive: true });
        await fs.promises.writeFile(path.join(tempDir, `${f.id}.md`), f.content);
        filesImported += 1;

        // Existing intents for dedupe by payload
        const existingIntentRows = await db.select({ payload: intents.payload })
          .from(intents)
          .innerJoin(intentIndexes, eq(intents.id, intentIndexes.intentId))
          .where(eq(intentIndexes.indexId, indexId));
        const existingIntents = existingIntentRows.map(r => r.payload);

        // Analyze just this page (count=1)
        const result = await analyzeFolder(
          tempDir,
          [f.id],
          `Generate intents based on content from ${meta.url}`,
          existingIntents,
          [],
          Math.max(1, Math.min(1, requestedCount)),
          60000
        );

        if (result.success && result.intents.length > 0) {
          const intentData = result.intents[0];
          // Generate summary for better UI display
          const summary = await summarizeIntent(intentData.payload);
          const inserted = await db.insert(intents).values({
            payload: intentData.payload,
            summary: summary || intentData.payload.slice(0, 150),
            userId,
            isIncognito: false,
          }).returning({ id: intents.id });
          const intentId = inserted[0].id;
          await db.insert(intentIndexes).values({ intentId, indexId });

          // Upsert mapping for this URL
          if (existing.length > 0) {
            await db.update(integrationItems)
              .set({ intentId, contentHash: meta.contentHash, lastSeenAt: new Date() })
              .where(eq(integrationItems.id, existing[0].id));
          } else {
            await db.insert(integrationItems).values({
              provider,
              externalId: meta.url,
              userId,
              indexId,
              intentId,
              contentHash: meta.contentHash,
            });
          }

          if (!skipBrokers) {
            triggerBrokersOnIntentCreated(intentId).catch(() => void 0);
          }
          intentsGenerated += 1;
        }
      }

      // Cleanup temp
      await fs.promises.rm(baseTempDir, { recursive: true, force: true });

      // Update link records with last sync info
      await db.update(indexLinks)
        .set({ lastSyncAt: new Date(), lastStatus: 'ok', lastError: null })
        .where(eq(indexLinks.indexId, indexId));

      const finishedAt = Date.now();
      return res.json({
        success: true,
        filesImported,
        intentsGenerated,
        links: links.length,
        pagesVisited: crawl.pagesVisited,
        durationMs: finishedAt - startedAt,
      });
    } catch (err) {
      console.error('Sync index links error:', err);
      return res.status(500).json({ error: 'Failed to sync links' });
    }
  }
);

export default router;
