import { Router, Response } from 'express';
import { body, validationResult } from 'express-validator';
import { authenticatePrivy, AuthRequest } from '../middleware/auth';

const router = Router();

// Submit feedback
router.post('/',
  authenticatePrivy,
  [
    body('feedback').trim().isLength({ max: 5000 }),
    body('image').optional().isString(),
  ],
  async (req: AuthRequest, res: Response) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }

      const { feedback, image } = req.body;

      if (!feedback && !image) {
        return res.status(400).json({ error: 'Feedback or image is required' });
      }

      // TODO: Store feedback in database
      // For now, log it to console
      console.log('Feedback received:', {
        userId: req.user!.id,
        feedback,
        hasImage: !!image,
        timestamp: new Date().toISOString(),
      });

      return res.json({ success: true });
    } catch (error) {
      console.error('Submit feedback error:', error);
      return res.status(500).json({ error: 'Failed to submit feedback' });
    }
  }
);

export default router;
