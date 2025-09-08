import { Router, Response } from 'express';
import { body, param, validationResult } from 'express-validator';
import db from '../lib/db';
import { indexLinks } from '../lib/schema';
import { authenticatePrivy, AuthRequest } from '../middleware/auth';
import { and, desc, eq } from 'drizzle-orm';
import { checkIndexAccess } from '../lib/index-access';
// queue removed; API is ack-only
 

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
  ],
  async (req: AuthRequest, res: Response) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

      const { indexId } = req.params;
      const { url } = req.body;

      const access = await checkIndexAccess(indexId, req.user!.id);
      if (!access.hasAccess) return res.status(access.status!).json({ error: access.error });

      if (!isValidUrlCandidate(url)) return res.status(400).json({ error: 'Invalid URL' });

      const inserted = await db.insert(indexLinks)
        .values({ indexId, url })
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

// Update a link (url, depth, pages, include/exclude)
router.patch('/:linkId',
  authenticatePrivy,
  [
    param('indexId').isUUID(),
    param('linkId').isUUID(),
    body('url').optional().isString().trim().isLength({ min: 1 }),
  ],
  async (req: AuthRequest, res: Response) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

      const { indexId, linkId } = req.params;
      const access = await checkIndexAccess(indexId, req.user!.id);
      if (!access.hasAccess) return res.status(access.status!).json({ error: access.error });

      const values: any = { updatedAt: new Date() };
      if (req.body.url !== undefined) values.url = req.body.url;
      // removed per-link crawl controls (depth/pages/include/exclude)

      const updated = await db.update(indexLinks)
        .set(values)
        .where(and(eq(indexLinks.id, linkId), eq(indexLinks.indexId, indexId)))
        .returning();

      if (updated.length === 0) return res.status(404).json({ error: 'Link not found' });
      return res.json({ link: updated[0] });
    } catch (err) {
      console.error('Update index link error:', err);
      return res.status(500).json({ error: 'Failed to update link' });
    }
  }
);

// Last sync status for this index's links
router.get('/status',
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
      const lastSyncAt = links.reduce<Date | null>((acc, l) => {
        const d = l.lastSyncAt ? new Date(l.lastSyncAt) : null;
        if (!d) return acc;
        if (!acc || d > acc) return d;
        return acc;
      }, null);
      const statuses = Array.from(new Set(links.map(l => l.lastStatus || '').filter(Boolean)));
      return res.json({ summary: { indexId, links: links.length, lastSyncAt, statuses }, links });
    } catch (err) {
      console.error('Get links status error:', err);
      return res.status(500).json({ error: 'Failed to fetch links status' });
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
      return res.status(202).json({ success: true, accepted: true });
    } catch (err) {
      console.error('Sync index links error:', err);
      return res.status(500).json({ error: 'Failed to sync links' });
    }
  }
);

export default router;
