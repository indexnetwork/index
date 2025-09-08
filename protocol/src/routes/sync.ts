import { Router, Response } from 'express';
import { body, validationResult } from 'express-validator';
import { authenticatePrivy, AuthRequest } from '../middleware/auth';
import { SyncProviderName } from '../lib/sync/types';

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
      // Kubernetes handles async execution; acknowledge immediately.
      return res.status(202).json({ accepted: true });
    } catch {
      return res.status(500).json({ error: 'Failed to accept sync request' });
    }
  }
);

export default router;
