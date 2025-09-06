import { Router, Response } from 'express';
import { body, param, validationResult } from 'express-validator';
import { authenticatePrivy, AuthRequest } from '../middleware/auth';
import { enqueue, getRun } from '../lib/sync/queue';
import { SyncProviderName } from '../lib/sync/types';
import { onRunUpdate, offRunUpdate } from '../lib/sync/events';

const router = Router();

router.post('/now',
  authenticatePrivy,
  [
    body('provider').isString().isIn(['links','gmail','notion','slack','discord','calendar']),
    body('params').optional().isObject(),
  ],
  async (req: AuthRequest, res: Response) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
    try {
      const provider = req.body.provider as SyncProviderName;
      const params = (req.body.params || {}) as Record<string, any>;
      const runId = await enqueue(provider, req.user!.id, params);
      return res.status(202).json({ runId });
    } catch (err) {
      return res.status(500).json({ error: 'Failed to enqueue sync' });
    }
  }
);

router.get('/runs/:runId',
  authenticatePrivy,
  [param('runId').isString()],
  async (req: AuthRequest, res: Response) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
    try {
      const run = await getRun(req.params.runId);
      if (!run) return res.status(404).json({ error: 'Run not found' });
      if (run.userId !== req.user!.id) return res.status(403).json({ error: 'Forbidden' });
      return res.json({ run });
    } catch (err) {
      return res.status(500).json({ error: 'Failed to fetch run' });
    }
  }
);

export default router;

// Server-Sent Events for live progress
router.get('/runs/:runId/events',
  authenticatePrivy,
  [param('runId').isString()],
  async (req: AuthRequest, res: Response) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

    const { runId } = req.params as any;
    const run = await getRun(runId);
    if (!run) return res.status(404).json({ error: 'Run not found' });
    if (run.userId !== req.user!.id) return res.status(403).json({ error: 'Forbidden' });

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders?.();

    const send = (r: any) => {
      res.write(`data: ${JSON.stringify({ run: r })}\n\n`);
    };

    const listener = (r: any) => send(r);
    onRunUpdate(runId, listener);
    // Send initial snapshot
    send(run);

    const heartbeat = setInterval(() => res.write(': ping\n\n'), 15000);
    req.on('close', () => {
      clearInterval(heartbeat);
      offRunUpdate(runId, listener);
      res.end();
    });
    return;
  }
);
