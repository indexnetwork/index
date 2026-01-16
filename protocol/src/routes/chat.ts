import { Router, Response } from 'express';
import { body, validationResult } from 'express-validator';
import { StreamChat } from 'stream-chat';
import { authenticatePrivy, AuthRequest } from '../middleware/auth';
import db from '../lib/db';

declare module 'stream-chat' {
  interface CustomChannelData {
    pending?: boolean;
    requestedBy?: string;
    awaitingAdminApproval?: boolean;
    declined?: boolean;
    skipped?: boolean;
  }
}
import { users, userConnectionEvents, indexMembers, indexes } from '../lib/schema';
import { eq, isNull, and, or, desc, inArray, sql } from 'drizzle-orm';
import { sendConnectionRequestNotification, sendConnectionAcceptedNotification } from '../lib/notification-service';

const router = Router();

const STREAM_API_KEY = process.env.STREAM_API_KEY || '6238du93us6h';
const STREAM_SECRET = process.env.STREAM_SECRET || 't3mw3chjktp9p5pu2cwfahusz3ndjzfumnaap488cap2kg7nff7a48kt8qtqcrn6';

// Helper: Check if users are connected
async function areUsersConnected(userId1: string, userId2: string): Promise<boolean> {
  const latestEvent = await db.select()
    .from(userConnectionEvents)
    .where(
      or(
        and(
          eq(userConnectionEvents.initiatorUserId, userId1),
          eq(userConnectionEvents.receiverUserId, userId2)
        ),
        and(
          eq(userConnectionEvents.initiatorUserId, userId2),
          eq(userConnectionEvents.receiverUserId, userId1)
        )
      )
    )
    .orderBy(desc(userConnectionEvents.createdAt))
    .limit(1);
  return latestEvent[0]?.eventType === 'ACCEPT';
}

// Helper: Get connection status between two users
async function getConnectionStatus(userId1: string, userId2: string): Promise<{ status: string | null; isInitiator: boolean }> {
  const latestEvent = await db.select()
    .from(userConnectionEvents)
    .where(
      or(
        and(
          eq(userConnectionEvents.initiatorUserId, userId1),
          eq(userConnectionEvents.receiverUserId, userId2)
        ),
        and(
          eq(userConnectionEvents.initiatorUserId, userId2),
          eq(userConnectionEvents.receiverUserId, userId1)
        )
      )
    )
    .orderBy(desc(userConnectionEvents.createdAt))
    .limit(1);

  return {
    status: latestEvent[0]?.eventType || null,
    isInitiator: latestEvent[0]?.initiatorUserId === userId1
  };
}

// Helper: Check if requireApproval is needed for shared indexes
async function requiresAdminApproval(userId1: string, userId2: string): Promise<boolean> {
  // Get shared indexes between users
  const memberships = await db.select({
    userId: indexMembers.userId,
    indexId: indexMembers.indexId,
    requireApproval: sql<boolean>`(${indexes.permissions}->>'requireApproval')::boolean`
  })
    .from(indexMembers)
    .innerJoin(indexes, eq(indexMembers.indexId, indexes.id))
    .where(inArray(indexMembers.userId, [userId1, userId2]));

  // Build map of indexes per user
  const userIndexMap = new Map<string, Set<string>>();
  const indexApprovalMap = new Map<string, boolean>();

  memberships.forEach(m => {
    if (!userIndexMap.has(m.userId)) userIndexMap.set(m.userId, new Set());
    userIndexMap.get(m.userId)!.add(m.indexId);
    indexApprovalMap.set(m.indexId, m.requireApproval === true);
  });

  const user1Indexes = userIndexMap.get(userId1) || new Set();
  const user2Indexes = userIndexMap.get(userId2) || new Set();

  // Find shared indexes
  const sharedIndexIds = [...user1Indexes].filter(id => user2Indexes.has(id));

  if (sharedIndexIds.length === 0) return false;

  // If ALL shared indexes require approval, return true
  return sharedIndexIds.every(id => indexApprovalMap.get(id) === true);
}

// Helper: Generate consistent channel ID
function generateChannelId(userId1: string, userId2: string): string {
  const sortedIds = [userId1, userId2].sort().join('_');
  if (sortedIds.length > 64) {
    let hash = 0;
    for (let i = 0; i < sortedIds.length; i++) {
      const char = sortedIds.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash;
    }
    return Math.abs(hash).toString(36).slice(0, 63);
  }
  return sortedIds;
}

// Generate Stream Chat token
router.post('/token',
  authenticatePrivy,
  [body('userId').isUUID()],
  async (req: AuthRequest, res: Response) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }

      const { userId } = req.body;

      // Verify user can only generate token for themselves
      if (req.user!.id !== userId) {
        return res.status(403).json({ error: 'Access denied' });
      }

      const serverClient = StreamChat.getInstance(STREAM_API_KEY, STREAM_SECRET);
      const token = serverClient.createToken(userId);

      return res.json({ token });
    } catch (error) {
      console.error('Error generating Stream token:', error);
      return res.status(500).json({ error: 'Failed to generate token' });
    }
  }
);

// Upsert user in Stream Chat
router.post('/user',
  authenticatePrivy,
  [
    body('userId').isUUID(),
    body('userName').trim().isLength({ min: 1, max: 255 }),
    body('userAvatar').optional().isURL(),
  ],
  async (req: AuthRequest, res: Response) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }

      const { userId, userName, userAvatar } = req.body;

      const serverClient = StreamChat.getInstance(STREAM_API_KEY, STREAM_SECRET);

      await serverClient.upsertUser({
        id: userId,
        name: userName,
        image: userAvatar || `https://api.dicebear.com/9.x/shapes/png?seed=${userId}`,
      });

      return res.json({ success: true });
    } catch (error) {
      console.error('Error upserting Stream user:', error);
      return res.status(500).json({ error: 'Failed to upsert user' });
    }
  }
);

// Create message request (Instagram-style first message)
router.post('/request',
  authenticatePrivy,
  [
    body('targetUserId').isUUID(),
    body('message').trim().isLength({ min: 1, max: 2000 }),
    body('targetUserName').trim().isLength({ min: 1, max: 255 }),
    body('targetUserAvatar').optional()
  ],
  async (req: AuthRequest, res: Response) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }

      const userId = req.user!.id;
      const { targetUserId, message, targetUserName, targetUserAvatar } = req.body;

      // Prevent self-messaging
      if (userId === targetUserId) {
        return res.status(400).json({ error: 'Cannot send message request to yourself' });
      }

      // Verify target user exists
      const [targetUser] = await db.select()
        .from(users)
        .where(and(eq(users.id, targetUserId), isNull(users.deletedAt)))
        .limit(1);

      if (!targetUser) {
        return res.status(404).json({ error: 'Target user not found' });
      }

      // Get current user info
      const [currentUser] = await db.select()
        .from(users)
        .where(eq(users.id, userId))
        .limit(1);

      if (!currentUser) {
        return res.status(404).json({ error: 'User not found' });
      }

      // Check connection status
      const connectionStatus = await getConnectionStatus(userId, targetUserId);

      // If already connected, just return channel info (they can message directly)
      if (connectionStatus.status === 'ACCEPT') {
        const channelId = generateChannelId(userId, targetUserId);
        return res.json({
          channelId,
          pending: false,
          alreadyConnected: true
        });
      }

      // If there's already a pending request from this user, don't allow another
      if (connectionStatus.status === 'REQUEST' && connectionStatus.isInitiator) {
        return res.status(400).json({ error: 'You already have a pending request to this user' });
      }

      // Check if admin approval is required
      const needsAdminApproval = await requiresAdminApproval(userId, targetUserId);

      // Create connection REQUEST event
      await db.insert(userConnectionEvents)
        .values({
          initiatorUserId: userId,
          receiverUserId: targetUserId,
          eventType: 'REQUEST',
        });

      // Create Stream Chat channel with pending state
      const serverClient = StreamChat.getInstance(STREAM_API_KEY, STREAM_SECRET);
      const channelId = generateChannelId(userId, targetUserId);

      // Ensure both users exist in Stream
      await serverClient.upsertUsers([
        {
          id: userId,
          name: currentUser.name,
          image: currentUser.avatar || `https://api.dicebear.com/9.x/shapes/png?seed=${userId}`,
        },
        {
          id: targetUserId,
          name: targetUserName || targetUser.name,
          image: targetUserAvatar || targetUser.avatar || `https://api.dicebear.com/9.x/shapes/png?seed=${targetUserId}`,
        }
      ]);

      // Create channel with pending metadata
      const channel = serverClient.channel('messaging', channelId, {
        members: [userId, targetUserId],
        created_by_id: userId,
        pending: true,
        requestedBy: userId,
        awaitingAdminApproval: needsAdminApproval,
      });
      await channel.create();

      // Send the first message
      await channel.sendMessage({
        text: message,
        user_id: userId,
      });

      // Send notification email (fire-and-forget)
      sendConnectionRequestNotification(userId, targetUserId).catch(console.error);

      return res.json({
        channelId,
        pending: true,
        awaitingAdminApproval: needsAdminApproval
      });
    } catch (error) {
      console.error('Error creating message request:', error);
      return res.status(500).json({ error: 'Failed to create message request' });
    }
  }
);

// Respond to message request (accept/decline/skip)
router.post('/request/respond',
  authenticatePrivy,
  [
    body('channelId').isString(),
    body('action').isIn(['ACCEPT', 'DECLINE', 'SKIP'])
  ],
  async (req: AuthRequest, res: Response) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }

      const userId = req.user!.id;
      const { channelId, action } = req.body;

      const serverClient = StreamChat.getInstance(STREAM_API_KEY, STREAM_SECRET);

      // Get channel
      const channels = await serverClient.queryChannels({ id: channelId });
      if (channels.length === 0) {
        return res.status(404).json({ error: 'Channel not found' });
      }

      const channel = channels[0];
      const channelData = channel.data as any;

      // Verify this is a pending request
      if (!channelData?.pending) {
        return res.status(400).json({ error: 'This is not a pending message request' });
      }

      // Verify user is the recipient (not the requester)
      if (channelData.requestedBy === userId) {
        return res.status(403).json({ error: 'Cannot respond to your own request' });
      }

      // Verify user is a member
      const members = Object.keys(channel.state.members || {});
      if (!members.includes(userId)) {
        return res.status(403).json({ error: 'Access denied' });
      }

      // Find the requester
      const requesterId = channelData.requestedBy;

      // Create connection event
      await db.insert(userConnectionEvents)
        .values({
          initiatorUserId: userId,
          receiverUserId: requesterId,
          eventType: action as any,
        });

      if (action === 'ACCEPT') {
        // Update channel to remove pending state
        await channel.updatePartial({
          set: { pending: false, awaitingAdminApproval: false },
          unset: ['requestedBy']
        });

        // Send acceptance notification
        sendConnectionAcceptedNotification(userId, requesterId).catch(console.error);

        return res.json({
          message: 'Message request accepted',
          channelId
        });
      } else {
        // DECLINE or SKIP - hide or delete the channel
        // For now, just mark as not pending and let it be hidden
        await channel.updatePartial({
          set: {
            pending: false,
            declined: action === 'DECLINE',
            skipped: action === 'SKIP'
          }
        });

        return res.json({
          message: `Message request ${action.toLowerCase()}ed`,
          channelId
        });
      }
    } catch (error) {
      console.error('Error responding to message request:', error);
      return res.status(500).json({ error: 'Failed to respond to message request' });
    }
  }
);

// Get pending message requests for current user
router.get('/requests',
  authenticatePrivy,
  async (req: AuthRequest, res: Response) => {
    try {
      const userId = req.user!.id;

      const serverClient = StreamChat.getInstance(STREAM_API_KEY, STREAM_SECRET);

      // Query channels where:
      // - User is a member
      // - Channel is pending
      // Note: $ne is not supported for custom fields, so we filter client-side
      const allPendingChannels = await serverClient.queryChannels({
        type: 'messaging',
        members: { $in: [userId] },
        pending: true
      }, { created_at: -1 });

      // Filter out channels where user is the requester or awaiting admin approval
      const channels = allPendingChannels.filter(ch => {
        const data = ch.data as any;
        // User should NOT be the requester (they should see incoming requests)
        if (data.requestedBy === userId) return false;
        // Don't show if waiting for admin approval
        if (data.awaitingAdminApproval === true) return false;
        return true;
      });

      const requests = channels.map(ch => {
        const data = ch.data as any;
        const members = Object.values(ch.state.members || {});
        const requester = members.find((m: any) => m.user_id === data.requestedBy);
        const lastMessage = ch.state.messages?.[ch.state.messages.length - 1];

        return {
          channelId: ch.id,
          requester: requester ? {
            id: (requester as any).user_id,
            name: (requester as any).user?.name,
            avatar: (requester as any).user?.image
          } : null,
          firstMessage: lastMessage?.text || null,
          createdAt: data.created_at
        };
      });

      return res.json({ requests });
    } catch (error) {
      console.error('Error fetching message requests:', error);
      return res.status(500).json({ error: 'Failed to fetch message requests' });
    }
  }
);

// Check if user can message another user directly (or needs to send request)
router.get('/can-message/:targetUserId',
  authenticatePrivy,
  async (req: AuthRequest, res: Response) => {
    try {
      const userId = req.user!.id;
      const { targetUserId } = req.params;

      if (userId === targetUserId) {
        return res.status(400).json({ error: 'Cannot check messaging with yourself' });
      }

      const connected = await areUsersConnected(userId, targetUserId);
      const connectionStatus = await getConnectionStatus(userId, targetUserId);

      return res.json({
        canMessageDirectly: connected,
        connectionStatus: connectionStatus.status,
        isInitiator: connectionStatus.isInitiator,
        requiresRequest: !connected && connectionStatus.status !== 'REQUEST'
      });
    } catch (error) {
      console.error('Error checking message permission:', error);
      return res.status(500).json({ error: 'Failed to check message permission' });
    }
  }
);

export default router;

