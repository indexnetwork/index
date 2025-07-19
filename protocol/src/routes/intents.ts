import { Router, Response, Request } from 'express';
import { body, query, param, validationResult } from 'express-validator';
import db from '../lib/db';
import { intents, users, indexes, intentIndexes, intentStakes, agents } from '../lib/schema';
import { authenticatePrivy, AuthRequest } from '../middleware/auth';
import { eq, isNull, isNotNull, and, count, desc, or, ilike, sql, inArray } from 'drizzle-orm';
import { summarizeIntent } from '../agents/core/intent_summarizer';
import { 
  triggerBrokersOnIntentCreated, 
  triggerBrokersOnIntentUpdated, 
  triggerBrokersOnIntentArchived 
} from '../agents/context_brokers/connector';
import { BaseContextBroker } from '../agents/context_brokers/base';
import { checkMultipleIndexesWriteAccess, checkMultipleIndexesIntentWriteAccess, checkIndexAccessByCode } from '../lib/index-access';

const router = Router();

// Get all intents with pagination
router.get('/', 
  authenticatePrivy,
  [
    query('page').optional().isInt({ min: 1 }).toInt(),
    query('limit').optional().isInt({ min: 1, max: 100 }).toInt(),
    query('archived').optional().isBoolean(),
    query('indexId').optional().isUUID(),
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
      const showArchived = req.query.archived === 'true';
      const indexId = req.query.indexId as string;

      // Build base conditions
      const baseCondition = and(
        showArchived ? isNotNull(intents.archivedAt) : isNull(intents.archivedAt),
        eq(intents.userId, req.user!.id)
      );

      const selectFields = {
        id: intents.id,
        payload: intents.payload,
        summary: intents.summary,
        isIncognito: intents.isIncognito,
        createdAt: intents.createdAt,
        updatedAt: intents.updatedAt,
        archivedAt: intents.archivedAt,
        userId: intents.userId,
        userName: users.name,
        userEmail: users.email,
        userAvatar: users.avatar
      };

      // Build queries conditionally
      const [intentsResult, totalResult] = await Promise.all([
        indexId 
          ? db.select(selectFields).from(intents)
              .innerJoin(users, eq(intents.userId, users.id))
              .innerJoin(intentIndexes, eq(intents.id, intentIndexes.intentId))
              .where(and(baseCondition, eq(intentIndexes.indexId, indexId)))
              .orderBy(desc(intents.createdAt))
              .offset(skip)
              .limit(limit)
          : db.select(selectFields).from(intents)
              .innerJoin(users, eq(intents.userId, users.id))
              .where(baseCondition)
              .orderBy(desc(intents.createdAt))
              .offset(skip)
              .limit(limit),
        
        indexId
          ? db.select({ count: count() }).from(intents)
              .innerJoin(users, eq(intents.userId, users.id))
              .innerJoin(intentIndexes, eq(intents.id, intentIndexes.intentId))
              .where(and(baseCondition, eq(intentIndexes.indexId, indexId)))
          : db.select({ count: count() }).from(intents)
              .innerJoin(users, eq(intents.userId, users.id))
              .where(baseCondition)
      ]);

      // Add index counts
      const intentsWithCounts = await Promise.all(
        intentsResult.map(async (intent) => {
          const indexCount = await db.select({ count: count() })
            .from(intentIndexes)
            .where(eq(intentIndexes.intentId, intent.id));

          return {
            ...intent,
            user: {
              id: intent.userId,
              name: intent.userName,
              email: intent.userEmail,
              avatar: intent.userAvatar
            },
            _count: { indexes: indexCount[0]?.count || 0 }
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
        summary: intents.summary,
        isIncognito: intents.isIncognito,
        createdAt: intents.createdAt,
        updatedAt: intents.updatedAt,
        archivedAt: intents.archivedAt,
        userId: intents.userId,
        userName: users.name,
        userEmail: users.email,
        userAvatar: users.avatar
      }).from(intents)
        .innerJoin(users, eq(intents.userId, users.id))
        .where(eq(intents.id, id))
        .limit(1);

      if (intent.length === 0) {
        return res.status(404).json({ error: 'Intent not found' });
      }

      // Check access permissions
      const intentData = intent[0];
      const hasAccess = intentData.userId === req.user!.id;

      if (!hasAccess) {
        return res.status(403).json({ error: 'Access denied' });
      }

      // Get intent's associated indexes
      const associatedIndexes = await db.select({
        indexId: intentIndexes.indexId,
        indexTitle: indexes.title
      }).from(intentIndexes)
        .innerJoin(indexes, eq(intentIndexes.indexId, indexes.id))
        .where(eq(intentIndexes.intentId, id));

      const result = {
        id: intentData.id,
        payload: intentData.payload,
        summary: intentData.summary,
        isIncognito: intentData.isIncognito,
        createdAt: intentData.createdAt,
        updatedAt: intentData.updatedAt,
        archivedAt: intentData.archivedAt,
        user: {
          id: intentData.userId,
          name: intentData.userName,
          email: intentData.userEmail,
          avatar: intentData.userAvatar
        },
        indexes: associatedIndexes,
        _count: {
          indexes: associatedIndexes.length
        }
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
    body('isIncognito').optional().isBoolean(),
    body('indexIds').optional().isArray(),
    body('indexIds.*').optional().isUUID(),
  ],
  async (req: AuthRequest, res: Response) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }

      const { payload, isIncognito = false, indexIds = [] } = req.body;

      // Verify index IDs exist and user has intent write access to them
      if (indexIds.length > 0) {
        const accessCheck = await checkMultipleIndexesIntentWriteAccess(indexIds, req.user!.id);
        
        if (!accessCheck.hasAccess) {
          return res.status(400).json({ 
            error: accessCheck.error,
            invalidIds: accessCheck.invalidIds 
          });
        }
      }

      const summary = await summarizeIntent(payload);
      
      const newIntent = await db.insert(intents).values({
        payload,
        summary,
        isIncognito,
        userId: req.user!.id,
              }).returning({
          id: intents.id,
          payload: intents.payload,
          summary: intents.summary,
          isIncognito: intents.isIncognito,
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

      // Trigger context brokers for new intent
      triggerBrokersOnIntentCreated(newIntent[0].id);

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
    body('isIncognito').optional().isBoolean(),
    body('indexIds').optional().isArray(),
    body('indexIds.*').optional().isUUID(),
  ],
  async (req: AuthRequest, res: Response) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }

      const { id } = req.params;
      const { payload, isIncognito, indexIds } = req.body;

      // Check if intent exists and user owns it
      const intent = await db.select({ id: intents.id, userId: intents.userId })
        .from(intents)
        .where(and(eq(intents.id, id), isNull(intents.archivedAt)))
        .limit(1);

      if (intent.length === 0) {
        return res.status(404).json({ error: 'Intent not found' });
      }

      if (intent[0].userId !== req.user!.id) {
        return res.status(403).json({ error: 'Access denied' });
      }

      // Verify index IDs exist and user has intent write access to them if indexIds is provided
      if (indexIds !== undefined && indexIds.length > 0) {
        const accessCheck = await checkMultipleIndexesIntentWriteAccess(indexIds, req.user!.id);
        
        if (!accessCheck.hasAccess) {
          return res.status(400).json({ 
            error: accessCheck.error,
            invalidIds: accessCheck.invalidIds 
          });
        }
      }

      const updateData: any = { updatedAt: new Date() };
      if (payload !== undefined) {
        updateData.payload = payload;
        const newSummary = await summarizeIntent(payload);
        if (newSummary) {
          updateData.summary = newSummary;
        }
      }
      if (isIncognito !== undefined) updateData.isIncognito = isIncognito;

      const updatedIntent = await db.update(intents)
        .set(updateData)
        .where(eq(intents.id, id))
        .returning({
          id: intents.id,
          payload: intents.payload,
          summary: intents.summary,
          isIncognito: intents.isIncognito,
          createdAt: intents.createdAt,
          updatedAt: intents.updatedAt,
          userId: intents.userId
        });

      // Update intent-index associations if indexIds is provided
      if (indexIds !== undefined) {
        // Delete existing associations
        await db.delete(intentIndexes)
          .where(eq(intentIndexes.intentId, id));

        // Insert new associations if any provided
        if (indexIds.length > 0) {
          await db.insert(intentIndexes).values(
            indexIds.map((indexId: string) => ({
              intentId: id,
              indexId: indexId
            }))
          );
        }
      }

      // Trigger context brokers for updated intent
      triggerBrokersOnIntentUpdated(updatedIntent[0].id);

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

// Archive intent
router.patch('/:id/archive',
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
        .where(and(eq(intents.id, id), isNull(intents.archivedAt)))
        .limit(1);

      if (intent.length === 0) {
        return res.status(404).json({ error: 'Intent not found' });
      }

      if (intent[0].userId !== req.user!.id) {
        return res.status(403).json({ error: 'Access denied' });
      }

      await db.update(intents)
        .set({ 
          archivedAt: new Date(),
          updatedAt: new Date()
        })
        .where(eq(intents.id, id));

      // Trigger context brokers for archived intent
      triggerBrokersOnIntentArchived(id);

      return res.json({ message: 'Intent archived successfully' });
    } catch (error) {
      console.error('Archive intent error:', error);
      return res.status(500).json({ error: 'Failed to archive intent' });
    }
  }
);

// Unarchive intent
router.patch('/:id/unarchive',
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
        .where(and(eq(intents.id, id), isNotNull(intents.archivedAt)))
        .limit(1);

      if (intent.length === 0) {
        return res.status(404).json({ error: 'Archived intent not found' });
      }

      if (intent[0].userId !== req.user!.id) {
        return res.status(403).json({ error: 'Access denied' });
      }

      await db.update(intents)
        .set({ 
          archivedAt: null,
          updatedAt: new Date()
        })
        .where(eq(intents.id, id));

      return res.json({ message: 'Intent unarchived successfully' });
    } catch (error) {
      console.error('Unarchive intent error:', error);
      return res.status(500).json({ error: 'Failed to unarchive intent' });
    }
  }
);

// Add indexes to intent
router.post('/:id/indexes',
  authenticatePrivy,
  [
    param('id').isUUID(),
    body('indexIds').isArray(),
    body('indexIds.*').isUUID(),
  ],
  async (req: AuthRequest, res: Response) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }

      const { id } = req.params;
      const { indexIds } = req.body;

      // Check if intent exists and user owns it
      const intent = await db.select({ id: intents.id, userId: intents.userId })
        .from(intents)
        .where(and(eq(intents.id, id), isNull(intents.archivedAt)))
        .limit(1);

      if (intent.length === 0) {
        return res.status(404).json({ error: 'Intent not found' });
      }

      if (intent[0].userId !== req.user!.id) {
        return res.status(403).json({ error: 'Access denied' });
      }

      // Verify index IDs exist and user has intent write access to them
      const accessCheck = await checkMultipleIndexesIntentWriteAccess(indexIds, req.user!.id);
      
      if (!accessCheck.hasAccess) {
        return res.status(400).json({ 
          error: accessCheck.error,
          invalidIds: accessCheck.invalidIds 
        });
      }

      const validIndexIds = accessCheck.validIndexIds;

      // Check for existing relationships to avoid duplicates
      const existingRelations = await db.select({ indexId: intentIndexes.indexId })
        .from(intentIndexes)
        .where(eq(intentIndexes.intentId, id));

      const existingIndexIds = existingRelations.map(rel => rel.indexId);
      const newIndexIds = indexIds.filter((indexId: string) => !existingIndexIds.includes(indexId));

      // Insert new relationships
      if (newIndexIds.length > 0) {
        await db.insert(intentIndexes).values(
          newIndexIds.map((indexId: string) => ({
            intentId: id,
            indexId: indexId
          }))
        );
      }

      return res.json({
        message: 'Indexes added to intent successfully',
        addedCount: newIndexIds.length,
        skippedCount: indexIds.length - newIndexIds.length
      });
    } catch (error) {
      console.error('Add indexes to intent error:', error);
      return res.status(500).json({ error: 'Failed to add indexes to intent' });
    }
  }
);

// Remove indexes from intent
router.delete('/:id/indexes',
  authenticatePrivy,
  [
    param('id').isUUID(),
    query('indexIds').custom((value) => {
      // Handle both single string and array of strings
      if (typeof value === 'string') {
        return true; // Single indexId
      }
      if (Array.isArray(value)) {
        return value.every(id => typeof id === 'string');
      }
      return false;
    }),
  ],
  async (req: AuthRequest, res: Response) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }

      const { id } = req.params;
      let indexIds = req.query.indexIds;

      // Normalize indexIds to array
      if (typeof indexIds === 'string') {
        indexIds = [indexIds];
      }
      if (!Array.isArray(indexIds)) {
        return res.status(400).json({ error: 'indexIds must be provided as query parameter' });
      }

      // Check if intent exists and user owns it
      const intent = await db.select({ id: intents.id, userId: intents.userId })
        .from(intents)
        .where(and(eq(intents.id, id), isNull(intents.archivedAt)))
        .limit(1);

      if (intent.length === 0) {
        return res.status(404).json({ error: 'Intent not found' });
      }

      if (intent[0].userId !== req.user!.id) {
        return res.status(403).json({ error: 'Access denied' });
      }

      // Verify user has intent write access to the indexes being removed
      const accessCheck = await checkMultipleIndexesIntentWriteAccess(indexIds as string[], req.user!.id);
      
      if (!accessCheck.hasAccess) {
        return res.status(400).json({ 
          error: accessCheck.error,
          invalidIds: accessCheck.invalidIds 
        });
      }

      const validIndexIds = accessCheck.validIndexIds;

      // Remove the relationships
      const deleteResult = await db.delete(intentIndexes)
        .where(and(
          eq(intentIndexes.intentId, id),
          inArray(intentIndexes.indexId, validIndexIds)
        ));

      return res.json({
        message: 'Indexes removed from intent successfully',
        removedCount: validIndexIds.length
      });
    } catch (error) {
      console.error('Remove indexes from intent error:', error);
      return res.status(500).json({ error: 'Failed to remove indexes from intent' });
    }
  }
);

// Create intent via share code (public endpoint)
router.post('/index/share/:code',
  authenticatePrivy,
  [
    param('code').isUUID(),
    body('payload').trim().isLength({ min: 1 }),
    body('isIncognito').optional().isBoolean(),
  ],
  async (req: AuthRequest, res: Response) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }

      const { code } = req.params;
      const { payload, isIncognito = false } = req.body;

      // Check access to the shared index
      const accessCheck = await checkIndexAccessByCode(code);
      if (!accessCheck.hasAccess) {
        return res.status(accessCheck.status!).json({ error: accessCheck.error });
      }

      const sharedIndexData = accessCheck.indexData!;

      // Check if the shared index has can-write-intents permission
      if (!accessCheck.memberPermissions?.includes('can-write-intents')) {
        return res.status(403).json({ error: 'Shared index does not allow intent creation' });
      }

      const summary = await summarizeIntent(payload);
      
      const newIntent = await db.insert(intents).values({
        payload,
        summary,
        isIncognito,
        userId: req.user!.id,
      }).returning({
        id: intents.id,
        payload: intents.payload,
        summary: intents.summary,
        isIncognito: intents.isIncognito,
        createdAt: intents.createdAt,
        updatedAt: intents.updatedAt,
        userId: intents.userId
      });

      // Associate with the shared index
      await db.insert(intentIndexes).values({
        intentId: newIntent[0].id,
        indexId: sharedIndexData.id
      });

      // Trigger context brokers for new intent
      triggerBrokersOnIntentCreated(newIntent[0].id);

      return res.status(201).json({
        message: 'Intent created successfully via shared index',
        intent: newIntent[0]
      });
    } catch (error) {
      console.error('Create intent via share code error:', error);
      return res.status(500).json({ error: 'Failed to create intent via shared index' });
    }
  }
);

export default router; 