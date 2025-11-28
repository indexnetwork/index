import { Router, Response } from 'express';
import { body, validationResult } from 'express-validator';
import { authenticatePrivy, AuthRequest } from '../middleware/auth';
import { runSync } from '../lib/sync';
import { getSyncProviderNames } from '../lib/integrations/config';
import { SyncResponse, SyncParams } from '../types';

const router = Router();

router.post('/now',
  authenticatePrivy,
  [
    body('provider').isString().isIn(getSyncProviderNames()),
    body('params').optional().isObject(),
  ],
  async (req: AuthRequest, res: Response) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
    try {
      // Fire and forget async sync
      runSync(req.body.provider, req.user!.id, req.body.params || {});
      
      return res.status(202).json({ accepted: true });
    } catch {
      return res.status(500).json({ error: 'Failed to accept sync request' });
    }
  }
);

export default router;
