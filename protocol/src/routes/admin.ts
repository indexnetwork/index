import { Router, Response } from 'express';
import { body, param, validationResult } from 'express-validator';
import db from '../lib/db';
import { users, userConnectionEvents, indexes, indexMembers } from '../lib/schema';
import { authenticatePrivy, AuthRequest } from '../middleware/auth';
import { eq, isNull, and, or, desc, inArray } from 'drizzle-orm';
import { checkIndexOwnership } from '../lib/index-access';
import { ConnectionEvent } from '../types';

const router = Router();

// Get pending connection requests for an index requiring approval
router.get('/:indexId/pending-connections',
  authenticatePrivy,
  [param('indexId').isUUID()],
  async (req: AuthRequest, res: Response) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }

      const userId = req.user!.id;
      const { indexId } = req.params;

      // Verify user is index owner
      const ownerCheck = await checkIndexOwnership(indexId, userId);
      if (!ownerCheck.hasAccess) {
        return res.status(ownerCheck.status || 403).json({ error: ownerCheck.error || 'Only index owners can view pending connections' });
      }

      // Verify index has requireApproval enabled
      const indexData = await db.select()
        .from(indexes)
        .where(and(eq(indexes.id, indexId), isNull(indexes.deletedAt)))
        .limit(1);

      if (indexData.length === 0) {
        return res.status(404).json({ error: 'Index not found' });
      }

      const requiresApproval = (indexData[0].permissions as any)?.requireApproval;
      if (!requiresApproval) {
        return res.json({ connections: [] });
      }

      // Get all members of this index
      const indexMemberIds = await db.select({ userId: indexMembers.userId })
        .from(indexMembers)
        .where(eq(indexMembers.indexId, indexId))
        .then(rows => rows.map(r => r.userId));

      if (indexMemberIds.length === 0) {
        return res.json({ connections: [] });
      }

      // Get connection events of type REQUEST where both users are index members
      const requestEvents = await db.select({
        id: userConnectionEvents.id,
        initiatorUserId: userConnectionEvents.initiatorUserId,
        receiverUserId: userConnectionEvents.receiverUserId,
        eventType: userConnectionEvents.eventType,
        createdAt: userConnectionEvents.createdAt,
      })
      .from(userConnectionEvents)
      .where(and(
        eq(userConnectionEvents.eventType, 'REQUEST'),
        inArray(userConnectionEvents.initiatorUserId, indexMemberIds),
        inArray(userConnectionEvents.receiverUserId, indexMemberIds)
      ))
      .orderBy(desc(userConnectionEvents.createdAt));

      // For each REQUEST, check if there's a subsequent action
      const pendingConnections = [];
      
      for (const event of requestEvents) {
        // Get any subsequent events for this pair
        const subsequentEvents = await db.select()
          .from(userConnectionEvents)
          .where(
            and(
              or(
                and(
                  eq(userConnectionEvents.initiatorUserId, event.initiatorUserId),
                  eq(userConnectionEvents.receiverUserId, event.receiverUserId)
                ),
                and(
                  eq(userConnectionEvents.initiatorUserId, event.receiverUserId),
                  eq(userConnectionEvents.receiverUserId, event.initiatorUserId)
                )
              )
            )
          )
          .orderBy(desc(userConnectionEvents.createdAt))
          .limit(1);

        // If latest event is still REQUEST, it's pending
        if (subsequentEvents[0]?.eventType === 'REQUEST' && subsequentEvents[0].id === event.id) {
          // Get user details
          const [initiator, receiver] = await Promise.all([
            db.select({
              id: users.id,
              name: users.name,
              avatar: users.avatar
            }).from(users).where(eq(users.id, event.initiatorUserId)).limit(1),
            db.select({
              id: users.id,
              name: users.name,
              avatar: users.avatar
            }).from(users).where(eq(users.id, event.receiverUserId)).limit(1)
          ]);

          if (initiator.length > 0 && receiver.length > 0) {
            pendingConnections.push({
              id: event.id,
              initiator: initiator[0],
              receiver: receiver[0],
              createdAt: event.createdAt
            });
          }
        }
      }

      return res.json({ connections: pendingConnections });
    } catch (error) {
      console.error('Get pending connections error:', error);
      return res.status(500).json({ error: 'Failed to fetch pending connections' });
    }
  }
);

// Approve a connection request
router.post('/:indexId/approve-connection',
  authenticatePrivy,
  [
    param('indexId').isUUID(),
    body('initiatorUserId').isUUID(),
    body('receiverUserId').isUUID()
  ],
  async (req: AuthRequest, res: Response) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }

      const userId = req.user!.id;
      const { indexId } = req.params;
      const { initiatorUserId, receiverUserId } = req.body;

      // Verify user is index owner
      const ownerCheck = await checkIndexOwnership(indexId, userId);
      if (!ownerCheck.hasAccess) {
        return res.status(ownerCheck.status || 403).json({ error: ownerCheck.error || 'Only index owners can approve connections' });
      }

      // Verify both users are members of this index
      const memberCheck = await db.select()
        .from(indexMembers)
        .where(and(
          eq(indexMembers.indexId, indexId),
          or(
            eq(indexMembers.userId, initiatorUserId),
            eq(indexMembers.userId, receiverUserId)
          )
        ));

      const memberIds = memberCheck.map(m => m.userId);
      if (!memberIds.includes(initiatorUserId) || !memberIds.includes(receiverUserId)) {
        return res.status(403).json({ error: 'Both users must be members of this index' });
      }

      // Verify connection request exists and is still pending
      const latestEvent = await db.select()
        .from(userConnectionEvents)
        .where(
          or(
            and(
              eq(userConnectionEvents.initiatorUserId, initiatorUserId),
              eq(userConnectionEvents.receiverUserId, receiverUserId)
            ),
            and(
              eq(userConnectionEvents.initiatorUserId, receiverUserId),
              eq(userConnectionEvents.receiverUserId, initiatorUserId)
            )
          )
        )
        .orderBy(desc(userConnectionEvents.createdAt))
        .limit(1);

      if (!latestEvent[0] || latestEvent[0].eventType !== 'REQUEST') {
        return res.status(400).json({ error: 'No pending connection request found' });
      }

      // Create OWNER_APPROVE event
      const approvalEvent = await db.insert(userConnectionEvents)
        .values({
          initiatorUserId: latestEvent[0].initiatorUserId,
          receiverUserId: latestEvent[0].receiverUserId,
          eventType: 'OWNER_APPROVE' as any,
        })
        .returning();

      return res.json({
        message: 'Connection approved successfully',
        event: approvalEvent[0]
      });
    } catch (error) {
      console.error('Approve connection error:', error);
      return res.status(500).json({ error: 'Failed to approve connection' });
    }
  }
);

// Deny a connection request
router.post('/:indexId/deny-connection',
  authenticatePrivy,
  [
    param('indexId').isUUID(),
    body('initiatorUserId').isUUID(),
    body('receiverUserId').isUUID()
  ],
  async (req: AuthRequest, res: Response) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }

      const userId = req.user!.id;
      const { indexId } = req.params;
      const { initiatorUserId, receiverUserId } = req.body;

      // Verify user is index owner
      const ownerCheck = await checkIndexOwnership(indexId, userId);
      if (!ownerCheck.hasAccess) {
        return res.status(ownerCheck.status || 403).json({ error: ownerCheck.error || 'Only index owners can deny connections' });
      }

      // Verify both users are members of this index
      const memberCheck = await db.select()
        .from(indexMembers)
        .where(and(
          eq(indexMembers.indexId, indexId),
          or(
            eq(indexMembers.userId, initiatorUserId),
            eq(indexMembers.userId, receiverUserId)
          )
        ));

      const memberIds = memberCheck.map(m => m.userId);
      if (!memberIds.includes(initiatorUserId) || !memberIds.includes(receiverUserId)) {
        return res.status(403).json({ error: 'Both users must be members of this index' });
      }

      // Verify connection request exists and is still pending
      const latestEvent = await db.select()
        .from(userConnectionEvents)
        .where(
          or(
            and(
              eq(userConnectionEvents.initiatorUserId, initiatorUserId),
              eq(userConnectionEvents.receiverUserId, receiverUserId)
            ),
            and(
              eq(userConnectionEvents.initiatorUserId, receiverUserId),
              eq(userConnectionEvents.receiverUserId, initiatorUserId)
            )
          )
        )
        .orderBy(desc(userConnectionEvents.createdAt))
        .limit(1);

      if (!latestEvent[0] || latestEvent[0].eventType !== 'REQUEST') {
        return res.status(400).json({ error: 'No pending connection request found' });
      }

      // Create OWNER_DENY event
      const denyEvent = await db.insert(userConnectionEvents)
        .values({
          initiatorUserId: latestEvent[0].initiatorUserId,
          receiverUserId: latestEvent[0].receiverUserId,
          eventType: 'OWNER_DENY' as any,
        })
        .returning();

      return res.json({
        message: 'Connection denied successfully',
        event: denyEvent[0]
      });
    } catch (error) {
      console.error('Deny connection error:', error);
      return res.status(500).json({ error: 'Failed to deny connection' });
    }
  }
);

// Get pending connection count for an index
router.get('/:indexId/pending-count',
  authenticatePrivy,
  [param('indexId').isUUID()],
  async (req: AuthRequest, res: Response) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }

      const userId = req.user!.id;
      const { indexId } = req.params;

      // Verify user is index owner
      const ownerCheck = await checkIndexOwnership(indexId, userId);
      if (!ownerCheck.hasAccess) {
        return res.json({ count: 0 });
      }

      // Verify index has requireApproval enabled
      const indexData = await db.select()
        .from(indexes)
        .where(and(eq(indexes.id, indexId), isNull(indexes.deletedAt)))
        .limit(1);

      if (indexData.length === 0 || !(indexData[0].permissions as any)?.requireApproval) {
        return res.json({ count: 0 });
      }

      // Get all members of this index
      const indexMemberIds = await db.select({ userId: indexMembers.userId })
        .from(indexMembers)
        .where(eq(indexMembers.indexId, indexId))
        .then(rows => rows.map(r => r.userId));

      if (indexMemberIds.length === 0) {
        return res.json({ count: 0 });
      }

      // Get REQUEST events where both users are index members and count those still pending
      const requestEvents = await db.select({
        id: userConnectionEvents.id,
        initiatorUserId: userConnectionEvents.initiatorUserId,
        receiverUserId: userConnectionEvents.receiverUserId,
      })
      .from(userConnectionEvents)
      .where(and(
        eq(userConnectionEvents.eventType, 'REQUEST'),
        inArray(userConnectionEvents.initiatorUserId, indexMemberIds),
        inArray(userConnectionEvents.receiverUserId, indexMemberIds)
      ));

      let pendingCount = 0;
      
      for (const event of requestEvents) {
        const subsequentEvents = await db.select()
          .from(userConnectionEvents)
          .where(
            and(
              or(
                and(
                  eq(userConnectionEvents.initiatorUserId, event.initiatorUserId),
                  eq(userConnectionEvents.receiverUserId, event.receiverUserId)
                ),
                and(
                  eq(userConnectionEvents.initiatorUserId, event.receiverUserId),
                  eq(userConnectionEvents.receiverUserId, event.initiatorUserId)
                )
              )
            )
          )
          .orderBy(desc(userConnectionEvents.createdAt))
          .limit(1);

        if (subsequentEvents[0]?.eventType === 'REQUEST' && subsequentEvents[0].id === event.id) {
          pendingCount++;
        }
      }

      return res.json({ count: pendingCount });
    } catch (error) {
      console.error('Get pending count error:', error);
      return res.status(500).json({ error: 'Failed to get pending count' });
    }
  }
);

export default router;

