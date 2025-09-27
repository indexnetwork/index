import { Router, Response } from 'express';
import { body, validationResult, param } from 'express-validator';
import db from '../lib/db';
import { indexLinks } from '../lib/schema';
import { authenticatePrivy, AuthRequest } from '../middleware/auth';
import { and, desc, eq } from 'drizzle-orm';
import path from 'path';
import fs from 'fs';
import { crawlLinksForIndex } from '../lib/crawl/web_crawler';
import { processFilesToIntents } from '../lib/sync/process-intents';

const router = Router();

function isValidUrlCandidate(u: string): boolean {
  try {
    const url = new URL(u);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

import { getUploadsPath } from '../lib/paths';

const baseStore = getUploadsPath('links');
if (!fs.existsSync(baseStore)) fs.mkdirSync(baseStore, { recursive: true });

async function crawlAndStore(userId: string, linkId: string, url: string) {
  try {
    // Mark as processing; progress bars belong in the frontend.
    await db.update(indexLinks).set({ lastStatus: 'processing' }).where(eq(indexLinks.id, linkId));
    const result = await crawlLinksForIndex([url]);
    const files = Array.isArray(result.files) ? result.files : [];
    const file = files[0];
    if (!files.length || !file?.content?.trim()) {
      await db.update(indexLinks)
        .set({ lastStatus: 'error: no-content', lastError: 'no-content' })
        .where(eq(indexLinks.id, linkId));
      return;
    }
    const dir = getUploadsPath('links', userId);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const filepath = path.join(dir, `${linkId}.md`);
    await fs.promises.writeFile(filepath, file.content);

    const { intentsGenerated } = await processFilesToIntents({
      userId,
      files: [file],
      textInstruction: `Generate intents based on content from ${url}`,
      count: 1,
      summarize: true,
      sourceId: linkId,
      sourceType: 'link',
    });

    await db.update(indexLinks)
      .set({ lastSyncAt: new Date(), lastStatus: `ok: intents=${intentsGenerated}`, lastError: null })
      .where(eq(indexLinks.id, linkId));
  } catch (e) {
    await db.update(indexLinks)
      .set({ lastError: (e as Error).message, lastStatus: 'error' })
      .where(eq(indexLinks.id, linkId));
  }
}

// List user links
router.get('/', authenticatePrivy, async (req: AuthRequest, res: Response) => {
  try {
    const links = await db.select().from(indexLinks)
      .where(eq(indexLinks.userId, req.user!.id))
      .orderBy(desc(indexLinks.createdAt));
    return res.json({ links });
  } catch (err) {
    console.error('List links error:', err);
    return res.status(500).json({ error: 'Failed to list links' });
  }
});

// Add a link (no index)
router.post('/',
  authenticatePrivy,
  [body('url').isString().trim().isLength({ min: 1 })],
  async (req: AuthRequest, res: Response) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

      const { url } = req.body;
      if (!isValidUrlCandidate(url)) return res.status(400).json({ error: 'Invalid URL' });

      const inserted = await db.insert(indexLinks)
        .values({ userId: req.user!.id, url, lastStatus: 'queued' })
        .returning();

      // Auto-crawl async
      crawlAndStore(req.user!.id, inserted[0].id, url).catch((err) => {
        console.error(`Background crawl failed for link ${inserted[0].id}:`, err);
      });

      return res.status(201).json({ link: inserted[0] });
    } catch (err) {
      console.error('Create link error:', err);
      return res.status(500).json({ error: 'Failed to add link' });
    }
  }
);

// Delete a link
router.delete('/:linkId', authenticatePrivy, [param('linkId').isUUID()], async (req: AuthRequest, res: Response) => {
  try {
    const { linkId } = req.params;
    await db.delete(indexLinks)
      .where(and(eq(indexLinks.id, linkId), eq(indexLinks.userId, req.user!.id)));
    const fpNew = path.join(getUploadsPath('links', req.user!.id), `${linkId}.md`);
    if (fs.existsSync(fpNew)) fs.unlinkSync(fpNew);
    return res.json({ success: true });
  } catch (err) {
    console.error('Delete link error:', err);
    return res.status(500).json({ error: 'Failed to delete link' });
  }
});

// Get crawled content (markdown)
router.get('/:linkId/content', authenticatePrivy, [param('linkId').isUUID()], async (req: AuthRequest, res: Response) => {
  try {
    const { linkId } = req.params;
    const rows = await db.select().from(indexLinks).where(and(eq(indexLinks.id, linkId), eq(indexLinks.userId, req.user!.id))).limit(1);
    if (rows.length === 0) return res.status(404).json({ error: 'Not found' });
    const fp = path.join(getUploadsPath('links', req.user!.id), `${linkId}.md`);
    const status = rows[0].lastStatus ?? '';
    if (!fs.existsSync(fp)) {
      if (status.startsWith('error')) {
        return res.status(200).json({ pending: false, error: status, lastStatus: status, lastSyncAt: rows[0].lastSyncAt, lastError: rows[0].lastError });
      }
      return res.status(202).json({ pending: true, lastStatus: status });
    }
    const content = await fs.promises.readFile(fp, 'utf-8');
    return res.json({ content, url: rows[0].url, lastSyncAt: rows[0].lastSyncAt, lastStatus: rows[0].lastStatus, lastError: rows[0].lastError });
  } catch (err) {
    console.error('Get content error:', err);
    return res.status(500).json({ error: 'Failed to get content' });
  }
});

export default router;
