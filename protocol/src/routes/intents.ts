import { Router, Response } from 'express';
import { body, query, param, validationResult } from 'express-validator';
import db from '../lib/db';
import { intents, users, indexes, intentIndexes } from '../lib/schema';
import { authenticatePrivy, AuthRequest } from '../middleware/auth';
import { eq, isNull, and, count, desc, or, ilike } from 'drizzle-orm';

const router = Router();

// Get all intents with pagination
router.get('/', 
  authenticatePrivy,
  [
    query('page').optional().isInt({ min: 1 }).toInt(),
    query('limit').optional().isInt({ min: 1, max: 100 }).toInt(),
  ],
  async (req: AuthRequest, res: Response) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }

      const page = Number(req.query.page) || 1;
      const limit = Number(req.query.limit) || 10;
      const skip = (page - 1) * limit;

      const whereCondition = and(
        isNull(intents.deletedAt),
        eq(intents.userId, req.user!.id)
      );

      const [intentsResult, totalResult] = await Promise.all([
        db.select({
          id: intents.id,
          payload: intents.payload,
          isPublic: intents.isPublic,
          createdAt: intents.createdAt,
          updatedAt: intents.updatedAt,
          userId: intents.userId,
          userName: users.name,
          userEmail: users.email,
          userAvatar: users.avatar
        }).from(intents)
          .innerJoin(users, eq(intents.userId, users.id))
          .where(whereCondition)
          .orderBy(desc(intents.createdAt))
          .offset(skip)
          .limit(limit),

        db.select({ count: count() })
          .from(intents)
          .innerJoin(users, eq(intents.userId, users.id))
          .where(whereCondition)
      ]);

      // Get index counts for each intent
      const intentsWithCounts = await Promise.all(
        intentsResult.map(async (intent) => {

          return {
            id: intent.id,
            payload: intent.payload,
            isPublic: intent.isPublic,
            createdAt: intent.createdAt,
            updatedAt: intent.updatedAt,
            user: {
              id: intent.userId,
              name: intent.userName,
              email: intent.userEmail,
              avatar: intent.userAvatar
            },
          };
        })
      );

      return res.json({
        intents: intentsWithCounts,
        pagination: {
          current: page,
          total: Math.ceil(totalResult[0].count / limit),
          count: intentsResult.length,
          totalCount: totalResult[0].count
        }
      });
    } catch (error) {
      console.error('Get intents error:', error);
      return res.status(500).json({ error: 'Failed to fetch intents' });
    }
  }
);

// Get single intent by ID
router.get('/:id',
  authenticatePrivy,
  [param('id').isUUID()],
  async (req: AuthRequest, res: Response) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }

      const { id } = req.params;

      const intent = await db.select({
        id: intents.id,
        payload: intents.payload,
        isPublic: intents.isPublic,
        createdAt: intents.createdAt,
        updatedAt: intents.updatedAt,
        userId: intents.userId,
        userName: users.name,
        userEmail: users.email,
        userAvatar: users.avatar
      }).from(intents)
        .innerJoin(users, eq(intents.userId, users.id))
        .where(and(eq(intents.id, id), isNull(intents.deletedAt)))
        .limit(1);

      if (intent.length === 0) {
        return res.status(404).json({ error: 'Intent not found' });
      }

      // Check access permissions
      const intentData = intent[0];
      const hasAccess = intentData.isPublic || intentData.userId === req.user!.id;

      if (!hasAccess) {
        return res.status(403).json({ error: 'Access denied' });
      }


      const result = {
        id: intentData.id,
        payload: intentData.payload,
        isPublic: intentData.isPublic,
        createdAt: intentData.createdAt,
        updatedAt: intentData.updatedAt,
        user: {
          id: intentData.userId,
          name: intentData.userName,
          email: intentData.userEmail,
          avatar: intentData.userAvatar
        },
      };

      return res.json({ intent: result });
    } catch (error) {
      console.error('Get intent error:', error);
      return res.status(500).json({ error: 'Failed to fetch intent' });
    }
  }
);

// Create new intent
router.post('/',
  authenticatePrivy,
  [
    body('payload').trim().isLength({ min: 1 }),
    body('isPublic').optional().isBoolean(),
    body('indexIds').optional().isArray(),
    body('indexIds.*').optional().isUUID(),
  ],
  async (req: AuthRequest, res: Response) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }

      const { payload, isPublic = false, indexIds = [] } = req.body;

      // Verify index IDs exist and user has access to them
      if (indexIds.length > 0) {
        const validIndexes = await db.select({ id: indexes.id })
          .from(indexes)
          .where(and(
            isNull(indexes.deletedAt),
            eq(indexes.userId, req.user!.id)
          ));

        const validIndexIds = validIndexes.map(idx => idx.id);
        const invalidIds = indexIds.filter((id: string) => !validIndexIds.includes(id));

        if (invalidIds.length > 0) {
          return res.status(400).json({ 
            error: 'Some index IDs are invalid or you don\'t have access to them',
            invalidIds 
          });
        }
      }

      const newIntent = await db.insert(intents).values({
        payload,
        isPublic,
        userId: req.user!.id,
      }).returning({
        id: intents.id,
        payload: intents.payload,
        isPublic: intents.isPublic,
        createdAt: intents.createdAt,
        updatedAt: intents.updatedAt,
        userId: intents.userId
      });

      // Associate with indexes if provided
      if (indexIds.length > 0) {
        await db.insert(intentIndexes).values(
          indexIds.map((indexId: string) => ({
            intentId: newIntent[0].id,
            indexId: indexId
          }))
        );
      }

      return res.status(201).json({
        message: 'Intent created successfully',
        intent: newIntent[0]
      });
    } catch (error) {
      console.error('Create intent error:', error);
      return res.status(500).json({ error: 'Failed to create intent' });
    }
  }
);

// Update intent
router.put('/:id',
  authenticatePrivy,
  [
    param('id').isUUID(),
    body('payload').optional().trim().isLength({ min: 1 }),
    body('isPublic').optional().isBoolean(),
  ],
  async (req: AuthRequest, res: Response) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }

      const { id } = req.params;
      const { payload, isPublic } = req.body;

      // Check if intent exists and user owns it
      const intent = await db.select({ id: intents.id, userId: intents.userId })
        .from(intents)
        .where(and(eq(intents.id, id), isNull(intents.deletedAt)))
        .limit(1);

      if (intent.length === 0) {
        return res.status(404).json({ error: 'Intent not found' });
      }

      if (intent[0].userId !== req.user!.id) {
        return res.status(403).json({ error: 'Access denied' });
      }

      const updateData: any = { updatedAt: new Date() };
      if (payload !== undefined) updateData.payload = payload;
      if (isPublic !== undefined) updateData.isPublic = isPublic;

      const updatedIntent = await db.update(intents)
        .set(updateData)
        .where(eq(intents.id, id))
        .returning({
          id: intents.id,
          payload: intents.payload,
          isPublic: intents.isPublic,
          createdAt: intents.createdAt,
          updatedAt: intents.updatedAt,
          userId: intents.userId
        });

      return res.json({
        message: 'Intent updated successfully',
        intent: updatedIntent[0]
      });
    } catch (error) {
      console.error('Update intent error:', error);
      return res.status(500).json({ error: 'Failed to update intent' });
    }
  }
);

// Delete intent (soft delete)
router.delete('/:id',
  authenticatePrivy,
  [param('id').isUUID()],
  async (req: AuthRequest, res: Response) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }

      const { id } = req.params;

      // Check if intent exists and user owns it
      const intent = await db.select({ id: intents.id, userId: intents.userId })
        .from(intents)
        .where(and(eq(intents.id, id), isNull(intents.deletedAt)))
        .limit(1);

      if (intent.length === 0) {
        return res.status(404).json({ error: 'Intent not found' });
      }

      if (intent[0].userId !== req.user!.id) {
        return res.status(403).json({ error: 'Access denied' });
      }

      await db.update(intents)
        .set({ 
          deletedAt: new Date(),
          updatedAt: new Date()
        })
        .where(eq(intents.id, id));

      return res.json({ message: 'Intent deleted successfully' });
    } catch (error) {
      console.error('Delete intent error:', error);
      return res.status(500).json({ error: 'Failed to delete intent' });
    }
  }
);


export default router; 