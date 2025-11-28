import { Router, Response } from 'express';
import { body, param, query, validationResult } from 'express-validator';
import db from '../lib/db';
import { users, userConnectionEvents, intents, intentIndexes } from '../lib/schema';
import { authenticatePrivy, AuthRequest } from '../middleware/auth';
import { eq, isNull, and, or, desc, sql, inArray } from 'drizzle-orm';
import { sendConnectionRequestEmail, sendConnectionAcceptedEmail, sendConnectionDeclinedEmail } from '../lib/email/email-handlers';
import { validateAndGetAccessibleIndexIds } from '../lib/index-access';
import { ConnectionEvent, ConnectionsByUserResponse, CreateConnectionActionRequest } from '../types';

const router = Router();


// Get connections by user (aggregated current state)
router.post('/by-user',
  authenticatePrivy,
  [
    body('type').optional().isIn(['inbox', 'pending', 'history']),
    body('page').optional().isInt({ min: 1 }).toInt(),
    body('limit').optional().isInt({ min: 1, max: 50 }).toInt(),
    body('indexIds').optional().isArray(),
    body('indexIds.*').optional().isUUID()
  ],
  async (req: AuthRequest, res: Response) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }

      const userId = req.user!.id;
      const { type = 'inbox', indexIds } = req.body;

      // Use generic validation function
      const { validIndexIds, error } = await validateAndGetAccessibleIndexIds(userId, indexIds);
      if (error) {
        return res.status(error.status).json({ 
          error: error.message,
          invalidIds: error.invalidIds 
        });
      }

      // If user has no accessible indexes, return empty results
      if (validIndexIds.length === 0) {
        return res.json({ connections: [] });
      }

      // Get all connection events involving this user
      const allEvents = await db.select({
        initiatorUserId: userConnectionEvents.initiatorUserId,
        receiverUserId: userConnectionEvents.receiverUserId,
        eventType: userConnectionEvents.eventType,
        createdAt: userConnectionEvents.createdAt,
      })
      .from(userConnectionEvents)
      .where(
        or(
          eq(userConnectionEvents.initiatorUserId, userId),
          eq(userConnectionEvents.receiverUserId, userId)
        )
      )
      .orderBy(desc(userConnectionEvents.createdAt));

      // Aggregate events by other user to get current state
      const connectionStates = new Map();
      
      for (const event of allEvents) {
        const otherUserId = event.initiatorUserId === userId ? event.receiverUserId : event.initiatorUserId;
        
        if (!connectionStates.has(otherUserId)) {
          connectionStates.set(otherUserId, {
            otherUserId,
            currentStatus: event.eventType,
            isInitiator: event.initiatorUserId === userId,
            lastUpdated: event.createdAt
          });
        }
      }

      // Filter by type and get user details
      const filteredConnections = Array.from(connectionStates.values()).filter(conn => {
        switch (type) {
          case 'inbox':
            return conn.currentStatus === 'REQUEST' && !conn.isInitiator;
          case 'pending':
            return conn.currentStatus === 'REQUEST' && conn.isInitiator;
          case 'history':
            return ['ACCEPT', 'DECLINE', 'SKIP', 'CANCEL'].includes(conn.currentStatus);
          default:
            return true;
        }
      });

      // Get user details for each connection
      if (filteredConnections.length === 0) {
        return res.json({ connections: [] });
      }

      let otherUserIds = filteredConnections.map(conn => conn.otherUserId);

      // Always filter by indexes - only include users who have intents in accessible indexes
      const usersWithIntentsInIndexes = await db.select({ userId: intents.userId })
        .from(intents)
        .innerJoin(intentIndexes, eq(intents.id, intentIndexes.intentId))
        .where(and(
          inArray(intents.userId, otherUserIds),
          inArray(intentIndexes.indexId, validIndexIds),
          isNull(intents.archivedAt)
        ));

      const validUserIds = new Set(usersWithIntentsInIndexes.map(u => u.userId));
      otherUserIds = otherUserIds.filter(userId => validUserIds.has(userId));

      if (otherUserIds.length === 0) {
        return res.json({ connections: [] });
      }

      
      const otherUsers = await db.select({
        id: users.id,
        name: users.name,
        avatar: users.avatar
      })
      .from(users)
      .where(inArray(users.id, otherUserIds));

      // Generate connections array with optional synthesis
      const connections = await Promise.all(
        filteredConnections.map(async (conn) => {
          const user = otherUsers.find(u => u.id === conn.otherUserId);
          if (!user) return null;

          return {
            user,
            status: conn.currentStatus,
            isInitiator: conn.isInitiator,
            lastUpdated: conn.lastUpdated
          };
        })
      );

      const validConnections = connections.filter(conn => conn !== null);

      return res.json({ connections: validConnections });
    } catch (error) {
      console.error('Get connections by user error:', error);
      return res.status(500).json({ error: 'Failed to fetch connections' });
    }
  }
);

// Create a connection action (REQUEST, SKIP, CANCEL, ACCEPT, DECLINE)
router.post('/actions',
  authenticatePrivy,
  [
    body('targetUserId').isUUID().withMessage('Target user ID must be a valid UUID'),
    body('action').isIn(['REQUEST', 'SKIP', 'CANCEL', 'ACCEPT', 'DECLINE'])
      .withMessage('Action must be one of: REQUEST, SKIP, CANCEL, ACCEPT, DECLINE')
  ],
  async (req: AuthRequest, res: Response) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }

      const userId = req.user!.id;
      const { targetUserId, action } = req.body;

      // Prevent self-connections
      if (userId === targetUserId) {
        return res.status(400).json({ error: 'Cannot connect to yourself' });
      }

      // Verify target user exists
      const targetUser = await db.select()
        .from(users)
        .where(and(eq(users.id, targetUserId), isNull(users.deletedAt)))
        .limit(1);

      if (targetUser.length === 0) {
        return res.status(404).json({ error: 'Target user not found' });
      }

      // Get the latest connection event between these users to determine current state
      const latestEvent = await db.select()
        .from(userConnectionEvents)
        .where(
          or(
            and(
              eq(userConnectionEvents.initiatorUserId, userId),
              eq(userConnectionEvents.receiverUserId, targetUserId)
            ),
            and(
              eq(userConnectionEvents.initiatorUserId, targetUserId),
              eq(userConnectionEvents.receiverUserId, userId)
            )
          )
        )
        .orderBy(desc(userConnectionEvents.createdAt))
        .limit(1);

      const currentState = latestEvent[0]?.eventType;

      // Validate action based on current state and user role
      const isInitiator = latestEvent[0]?.initiatorUserId === userId;
      const isReceiver = latestEvent[0]?.receiverUserId === userId;

      // Business logic for valid transitions
      let isValidAction = false;
      let newInitiatorId = userId;
      let newReceiverId = targetUserId;

      switch (action) {
        case 'REQUEST':
          // Can request if no prior connection or if previously declined/skipped
          isValidAction = !currentState || 
                         currentState === 'DECLINE' || 
                         currentState === 'SKIP' ||
                         currentState === 'CANCEL';
          break;
        case 'SKIP':
          // Can skip if receiving a request
          isValidAction = currentState === 'REQUEST' && isReceiver;
          break;
        case 'ACCEPT':
          // Can accept if receiving a request
          isValidAction = currentState === 'REQUEST' && isReceiver;
          break;
        case 'DECLINE':
          // Can decline if receiving a request
          isValidAction = currentState === 'REQUEST' && isReceiver;
          break;
        case 'CANCEL':
          // Can cancel if you initiated the request and it's still pending
          isValidAction = currentState === 'REQUEST' && isInitiator;
          break;
      }

      if (!isValidAction) {
        return res.status(400).json({ 
          error: `Cannot ${action.toLowerCase()} in current state: ${currentState}` 
        });
      }

      // Create the new connection event
      const newEvent = await db.insert(userConnectionEvents)
        .values({
          initiatorUserId: newInitiatorId,
          receiverUserId: newReceiverId,
          eventType: action as any,
        })
        .returning();

      // Send appropriate emails asynchronously (fire-and-forget)
      if (action === 'REQUEST') {
        sendConnectionRequestEmail(userId, targetUserId).catch(emailError => {
          console.error('Failed to send connection request email:', emailError);
        });
      } else if (action === 'ACCEPT') {
        sendConnectionAcceptedEmail(userId, targetUserId).catch(emailError => {
          console.error('Failed to send connection accepted email:', emailError);
        });
      } else if (action === 'DECLINE') {
        sendConnectionDeclinedEmail(targetUserId).catch(emailError => {
          console.error('Failed to send connection declined email:', emailError);
        });
      }

      return res.json({
        message: `Connection ${action.toLowerCase()} successful`,
        event: newEvent[0]
      });
    } catch (error) {
      console.error('Create connection action error:', error);
      return res.status(500).json({ error: 'Failed to create connection action' });
    }
  }
);

// Get connection status between current user and target user
router.get('/status/:targetUserId',
  authenticatePrivy,
  [param('targetUserId').isUUID()],
  async (req: AuthRequest, res: Response) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }

      const userId = req.user!.id;
      const { targetUserId } = req.params;

      if (userId === targetUserId) {
        return res.status(400).json({ error: 'Cannot check connection status with yourself' });
      }

      // Get latest connection event between these users
      const latestEvent = await db.select()
        .from(userConnectionEvents)
        .where(
          or(
            and(
              eq(userConnectionEvents.initiatorUserId, userId),
              eq(userConnectionEvents.receiverUserId, targetUserId)
            ),
            and(
              eq(userConnectionEvents.initiatorUserId, targetUserId),
              eq(userConnectionEvents.receiverUserId, userId)
            )
          )
        )
        .orderBy(desc(userConnectionEvents.createdAt))
        .limit(1);

      const status = latestEvent[0]?.eventType || 'none';
      const isInitiator = latestEvent[0]?.initiatorUserId === userId;

      return res.json({
        status,
        isInitiator,
        event: latestEvent[0] || null
      });
    } catch (error) {
      console.error('Get connection status error:', error);
      return res.status(500).json({ error: 'Failed to get connection status' });
    }
  }
);

export default router; 