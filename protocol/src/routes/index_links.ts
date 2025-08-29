import { Router, Response } from 'express';
import { body, param, validationResult } from 'express-validator';
import db from '../lib/db';
import { indexLinks } from '../lib/schema';
import { authenticatePrivy, AuthRequest } from '../middleware/auth';
import { and, desc, eq, isNull } from 'drizzle-orm';
import { checkIndexAccess } from '../lib/index-access';

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

      // Placeholder: read links and return a no-op result for now
      const links = await db.select().from(indexLinks).where(eq(indexLinks.indexId, indexId));
      return res.json({ success: true, filesImported: 0, intentsGenerated: 0, links: links.length });
    } catch (err) {
      console.error('Sync index links error:', err);
      return res.status(500).json({ error: 'Failed to sync links' });
    }
  }
);

export default router;

