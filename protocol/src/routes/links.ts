import { Router, Response } from 'express';
import { body, validationResult, param } from 'express-validator';
import db from '../lib/db';
import { indexLinks } from '../lib/schema';
import { authenticatePrivy, AuthRequest } from '../middleware/auth';
import { and, desc, eq } from 'drizzle-orm';
import path from 'path';
import fs from 'fs';
import { crawlLinksForIndex } from '../lib/crawl/web_crawler';
import { privyClient } from '../lib/privy';
import { users } from '../lib/schema';

const router = Router();

const sseClients = new Map<string, Set<Response>>();
function pushTo(userId: string, data: any) {
  const set = sseClients.get(userId);
  if (!set) return;
  const payload = `data: ${JSON.stringify(data)}\n\n`;
  for (const res of set) {
    try { res.write(payload); } catch {}
  }
}

function isValidUrlCandidate(u: string): boolean {
  try {
    const url = new URL(u);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

const baseStore = path.join(__dirname, '../../uploads/links');
if (!fs.existsSync(baseStore)) fs.mkdirSync(baseStore, { recursive: true });

async function crawlAndStore(userId: string, linkId: string, url: string) {
  try {
    // Mark as processing; progress bars belong in the frontend.
    await db.update(indexLinks).set({ lastStatus: 'processing' }).where(eq(indexLinks.id, linkId));
    pushTo(userId, { type: 'link-status', id: linkId, status: 'processing' });
    const result = await crawlLinksForIndex([url]);
    const file = result.files[0];
    if (!file) return;
    const dir = path.join(baseStore, userId);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const filepath = path.join(dir, `${linkId}.md`);
    await fs.promises.writeFile(filepath, file.content);
    await db.update(indexLinks)
      .set({ lastSyncAt: new Date(), lastStatus: 'ok' })
      .where(eq(indexLinks.id, linkId));
    pushTo(userId, { type: 'link-status', id: linkId, status: 'ok' });
  } catch (e) {
    await db.update(indexLinks)
      .set({ lastError: (e as Error).message, lastStatus: 'error' })
      .where(eq(indexLinks.id, linkId));
    pushTo(userId, { type: 'link-status', id: linkId, status: 'error' });
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

// Server-Sent Events for link status updates
router.get('/events', async (req: any, res: Response) => {
  try {
    const token = String(req.query.token || '');
    if (!token) return res.status(401).json({ error: 'Access token required' });
    const claims = await privyClient.verifyAuthToken(token);
    if (!claims?.userId) return res.status(403).json({ error: 'Invalid token' });
    const row = await db.select({ id: users.id }).from(users).where(eq(users.privyId, claims.userId)).limit(1);
    if (row.length === 0) return res.status(403).json({ error: 'Unknown user' });
    const userId = row[0].id;
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders?.();
    res.write(': ok\n\n');
    const set = sseClients.get(userId) || new Set<Response>();
    set.add(res);
    sseClients.set(userId, set);
    const keepalive = setInterval(() => { try { res.write(': ping\n\n'); } catch {} }, 25000);
    req.on('close', () => {
      clearInterval(keepalive);
      const s = sseClients.get(userId);
      if (s) { s.delete(res); if (s.size === 0) sseClients.delete(userId); }
    });
  } catch (e) {
    return res.status(500).json({ error: 'SSE setup failed' });
  }
  return undefined as any;
});

// Delete a link
router.delete('/:linkId', authenticatePrivy, [param('linkId').isUUID()], async (req: AuthRequest, res: Response) => {
  try {
    const { linkId } = req.params;
    await db.delete(indexLinks)
      .where(and(eq(indexLinks.id, linkId), eq(indexLinks.userId, req.user!.id)));
    const fpNew = path.join(baseStore, req.user!.id, `${linkId}.md`);
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
    const fp = path.join(baseStore, req.user!.id, `${linkId}.md`);
    if (!fs.existsSync(fp)) return res.status(202).json({ pending: true, lastStatus: rows[0].lastStatus });
    const content = await fs.promises.readFile(fp, 'utf-8');
    return res.json({ content, url: rows[0].url, lastSyncAt: rows[0].lastSyncAt, lastStatus: rows[0].lastStatus });
  } catch (err) {
    console.error('Get content error:', err);
    return res.status(500).json({ error: 'Failed to get content' });
  }
});

export default router;
