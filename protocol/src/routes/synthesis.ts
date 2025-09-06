import { Router, Response } from 'express';
import { body, param, query, validationResult } from 'express-validator';
import db from '../lib/db';
import { intents, intentStakes, agents, users, intentIndexes } from '../lib/schema';
import { authenticatePrivy, AuthRequest } from '../middleware/auth';
import { eq, isNull, and, sql, inArray } from 'drizzle-orm';
import { synthesizeVibeCheck } from '../lib/synthesis';
import { validateAndGetAccessibleIndexIds } from '../lib/index-access';
import { getAccessibleIntents } from '../lib/intent-access';

const router = Router();

// Generate synthesis between two users
router.post('/vibecheck',
  authenticatePrivy,
  [
    body('targetUserId').isUUID().withMessage('Target user ID must be a valid UUID'),
    body('intentIds').optional().isArray().withMessage('Intent IDs must be an array'),
    body('intentIds.*').optional().isUUID().withMessage('Each intent ID must be a valid UUID'),
    body('indexIds').optional().isArray().withMessage('Index IDs must be an array'),
    body('indexIds.*').optional().isUUID().withMessage('Each index ID must be a valid UUID'),
    body('userIds').optional().isArray().withMessage('User IDs must be an array'),
    body('userIds.*').optional().isUUID().withMessage('Each user ID must be a valid UUID'),
    body('offset').optional().isInt({ min: 0 }).withMessage('Offset must be a non-negative integer'),
    body('limit').optional().isInt({ min: 1, max: 100 }).withMessage('Limit must be between 1 and 100'),
    body('options').optional().isObject().withMessage('Options must be an object')
  ],
  async (req: AuthRequest, res: Response) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }

      const contextUserId = req.user!.id;
      const { targetUserId, intentIds, indexIds, userIds, offset, limit, options } = req.body;

      // Prevent self-synthesis
      if (contextUserId === targetUserId) {
        return res.status(400).json({ error: 'Cannot generate synthesis for yourself' });
      }

      // Use generic validation function
      const { validIndexIds, error } = await validateAndGetAccessibleIndexIds(contextUserId, indexIds);
      if (error) {
        return res.status(error.status).json({ 
          error: error.message,
          invalidIds: error.invalidIds 
        });
      }

      // If user has no accessible indexes, return error
      if (validIndexIds.length === 0) {
        return res.status(400).json({ error: 'No accessible indexes found for synthesis' });
      }

      const result = await synthesizeVibeCheck({
        targetUserId,
        contextUserId,
        intentIds,
        indexIds: validIndexIds,
        userIds,
        offset,
        limit,
        options
      });

      return res.json({
        synthesis: result.synthesis,
        total: result.total,
        offset: result.offset,
        limit: result.limit,
        targetUserId,
        contextUserId,
      });

    } catch (error) {
      console.error('Synthesis vibecheck error:', error);
      return res.status(500).json({ error: 'Failed to generate synthesis' });
    }
  }
);

export default router; 