import { Router, Response, Request } from 'express';
import { body, query, param, validationResult } from 'express-validator';
import db from '../lib/db';
import { indexes, users, indexMembers, intentIndexes, intents } from '../lib/schema';
import { authenticatePrivy, AuthRequest } from '../middleware/auth';
import { eq, isNull, isNotNull, and, count, desc, or, ilike, exists, sql } from 'drizzle-orm';
import { 
  checkIndexOwnership, 
  getUserAccessibleIndexIds,
  checkMultipleIndexesMembership,
  validateOwnershipChange,
  validateInvitationCode,
  checkUserIndexAccess,
  EVERYONE_USER_ID
} from '../lib/index-access';
import { Events } from '../lib/events';
import { IntentService } from '../services/intent-service';
// Removed intent-filtering import - using existing suggestions system
import crypto from 'crypto';



const router = Router();

// Discover public indexes (indexes that anyone can join)
router.get('/discover/public',
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
      const userId = req.user!.id;

      // Find public indexes (joinPolicy: 'anyone')
      const whereCondition = and(
        isNull(indexes.deletedAt),
        sql`${indexes.permissions}->>'joinPolicy' = 'anyone'`
      );

      const [indexesResult, totalResult] = await Promise.all([
        db.select({
          id: indexes.id,
          title: indexes.title,
          prompt: indexes.prompt,
          permissions: indexes.permissions,
          createdAt: indexes.createdAt,
          updatedAt: indexes.updatedAt,
          ownerId: indexMembers.userId,
          userName: users.name,
          userEmail: users.email,
          userAvatar: users.avatar
        }).from(indexes)
          .innerJoin(indexMembers, and(
            eq(indexes.id, indexMembers.indexId),
            sql`'owner' = ANY(${indexMembers.permissions})`
          ))
          .innerJoin(users, eq(indexMembers.userId, users.id))
          .where(whereCondition)
          .orderBy(desc(indexes.createdAt))
          .offset(skip)
          .limit(limit),

        db.select({ count: count() })
          .from(indexes)
          .where(whereCondition)
      ]);

      // Get member counts and check if user is already a member
      const indexesWithDetails = await Promise.all(
        indexesResult.map(async (index) => {
          const [memberCount, userMembership] = await Promise.all([
            db.select({ count: count() })
              .from(indexMembers)
              .where(eq(indexMembers.indexId, index.id)),
            db.select({ userId: indexMembers.userId })
              .from(indexMembers)
              .where(and(
                eq(indexMembers.indexId, index.id),
                eq(indexMembers.userId, userId)
              ))
              .limit(1)
          ]);
          
          return {
            id: index.id,
            title: index.title,
            prompt: index.prompt,
            permissions: index.permissions,
            createdAt: index.createdAt,
            updatedAt: index.updatedAt,
            user: {
              id: index.ownerId,
              name: index.userName,
              email: index.userEmail,
              avatar: index.userAvatar
            },
            _count: {
              members: memberCount[0].count,
              files: 0
            },
            isMember: userMembership.length > 0
          };
        })
      );

      return res.json({
        indexes: indexesWithDetails,
        pagination: {
          current: page,
          total: Math.ceil(Number(totalResult[0].count) / limit),
          count: indexesWithDetails.length,
          totalCount: Number(totalResult[0].count)
        }
      });
    } catch (error) {
      console.error('Discover public indexes error:', error);
      return res.status(500).json({ error: 'Failed to discover public indexes' });
    }
  }
);

// Get all indexes with pagination
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

      // Get all accessible index IDs for the user
      const accessibleIndexIds = await getUserAccessibleIndexIds(req.user!.id);
      
      if (accessibleIndexIds.length === 0) {
        return res.json({
          indexes: [],
          pagination: {
            current: page,
            total: 0,
            count: 0,
            totalCount: 0
          }
        });
      }

      const whereCondition = and(
        isNull(indexes.deletedAt),
        // User must be a member of the index (including owners)
        exists(
          db.select({ indexId: indexMembers.indexId })
            .from(indexMembers)
            .where(and(
              eq(indexMembers.indexId, indexes.id),
              or(
                eq(indexMembers.userId, req.user!.id),
                eq(indexMembers.userId, EVERYONE_USER_ID)
              )
            ))
        )
      ) ?? isNull(indexes.deletedAt);

      const [indexesResult, totalResult] = await Promise.all([
        db.select({
          id: indexes.id,
          title: indexes.title,
          prompt: indexes.prompt,
          permissions: indexes.permissions,
          createdAt: indexes.createdAt,
          updatedAt: indexes.updatedAt,
          ownerId: indexMembers.userId,
          userName: users.name,
          userEmail: users.email,
          userAvatar: users.avatar
        }).from(indexes)
          .innerJoin(indexMembers, and(
            eq(indexes.id, indexMembers.indexId),
            sql`'owner' = ANY(${indexMembers.permissions})`
          ))
          .innerJoin(users, eq(indexMembers.userId, users.id))
          .where(whereCondition)
          .orderBy(desc(indexes.createdAt))
          .offset(skip)
          .limit(limit),

        db.select({ count: count() })
          .from(indexes)
          .innerJoin(indexMembers, and(
            eq(indexes.id, indexMembers.indexId),
            sql`'owner' = ANY(${indexMembers.permissions})`
          ))
          .where(whereCondition)
      ]);

      // Get member counts
      const indexesWithCounts = await Promise.all(
        indexesResult.map(async (index) => {
          const [memberCount] = await Promise.all([
            db.select({ count: count() })
              .from(indexMembers)
              .where(eq(indexMembers.indexId, index.id))
          ]);
          return {
            id: index.id,
            title: index.title,
            prompt: index.prompt,
            permissions: index.permissions,
            createdAt: index.createdAt,
            updatedAt: index.updatedAt,
            user: {
              id: index.ownerId,
              name: index.userName,
              email: index.userEmail,
              avatar: index.userAvatar
            },
            _count: {
              members: memberCount[0].count
            }
          };
        })
      );

      return res.json({
        indexes: indexesWithCounts,
        pagination: {
          current: page,
          total: Math.ceil(totalResult[0].count / limit),
          count: indexesResult.length,
          totalCount: totalResult[0].count
        }
      });
    } catch (error) {
      console.error('Get indexes error:', error);
      return res.status(500).json({ error: 'Failed to fetch indexes' });
    }
  }
);

// Search users for adding as members
router.get('/search-users',
  authenticatePrivy,
  [
    query('q').trim().isLength({ min: 1 }),
    query('indexId').optional().isUUID(),
  ],
  async (req: AuthRequest, res: Response) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }

      const { q, indexId } = req.query;
      const searchQuery = `%${q}%`;

      let whereCondition = and(
        isNull(users.deletedAt),
        or(
          ilike(users.name, searchQuery),
          ilike(users.email, searchQuery)
        )
      );

      const searchResults = await db.select({
        id: users.id,
        name: users.name,
        email: users.email,
        avatar: users.avatar
      }).from(users)
        .where(whereCondition)
        .limit(10);

      // If indexId is provided, filter out existing members
      let filteredResults = searchResults;
      if (indexId) {
        const existingMembers = await db.select({ userId: indexMembers.userId })
          .from(indexMembers)
          .where(eq(indexMembers.indexId, indexId as string));
        
        const existingMemberIds = existingMembers.map(m => m.userId);
        filteredResults = searchResults.filter(user => !existingMemberIds.includes(user.id));
      }

      return res.json({ users: filteredResults });
    } catch (error) {
      console.error('Search users error:', error);
      return res.status(500).json({ error: 'Failed to search users' });
    }
  }
);

// Get single index by ID
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

      const accessCheck = await checkUserIndexAccess(id, req.user!.id);
      if (!accessCheck.hasAccess) {
        return res.status(accessCheck.status!).json({ error: accessCheck.error });
      }

      const index = await db.select({
        id: indexes.id,
        title: indexes.title,
        prompt: indexes.prompt,
        permissions: indexes.permissions,
        createdAt: indexes.createdAt,
        updatedAt: indexes.updatedAt,
        ownerId: indexMembers.userId,
        userName: users.name,
        userEmail: users.email,
        userAvatar: users.avatar
      }).from(indexes)
        .innerJoin(indexMembers, and(
          eq(indexes.id, indexMembers.indexId),
          sql`'owner' = ANY(${indexMembers.permissions})`
        ))
        .innerJoin(users, eq(indexMembers.userId, users.id))
        .where(and(eq(indexes.id, id), isNull(indexes.deletedAt)))
        .limit(1);

      // Get related data
      const [indexMembersData, intentCount] = await Promise.all([
        db.select({
          userId: indexMembers.userId,
          userName: users.name,
          userEmail: users.email,
          userAvatar: users.avatar,
          permissions: indexMembers.permissions,
          memberCreatedAt: indexMembers.createdAt
        }).from(indexMembers)
          .innerJoin(users, eq(indexMembers.userId, users.id))
          .where(eq(indexMembers.indexId, id))
          .limit(10),

        db.select({ count: count() })
          .from(intentIndexes)
          .where(eq(intentIndexes.indexId, id))
      ]);

      const indexData = index[0];
      
      const result = {
        id: indexData.id,
        title: indexData.title,
        prompt: indexData.prompt,
        permissions: indexData.permissions,
        createdAt: indexData.createdAt,
        updatedAt: indexData.updatedAt,
        user: {
          id: indexData.ownerId,
          name: indexData.userName,
          email: indexData.userEmail,
          avatar: indexData.userAvatar
        },
        members: indexMembersData.map(member => ({
          id: member.userId,
          name: member.userName,
          email: member.userEmail,
          avatar: member.userAvatar,
          permissions: member.permissions,
          createdAt: member.memberCreatedAt
        })),
        _count: {
          members: indexMembersData.length,
          intents: intentCount[0].count
        }
      };

      return res.json({ index: result });
    } catch (error) {
      console.error('Get index error:', error);
      return res.status(500).json({ error: 'Failed to fetch index' });
    }
  }
);

// Create new index
router.post('/',
  authenticatePrivy,
  [
    body('title').trim().isLength({ min: 1, max: 255 }),
    body('prompt').optional().trim(),
    body('joinPolicy').optional().isIn(['anyone', 'invite_only']),
  ],
  async (req: AuthRequest, res: Response) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }

      const { title, prompt, joinPolicy } = req.body;

      // Set up permissions with joinPolicy
      const finalJoinPolicy = joinPolicy || 'invite_only';
      const permissions = {
        joinPolicy: finalJoinPolicy,
        invitationLink: { code: crypto.randomUUID() }, // Always generate share code
        allowGuestVibeCheck: false
      };

      const newIndex = await db.insert(indexes).values({
        title,
        prompt: prompt || null,
        permissions,
      }).returning({
        id: indexes.id,
        title: indexes.title,
        prompt: indexes.prompt,
        permissions: indexes.permissions,
        createdAt: indexes.createdAt,
        updatedAt: indexes.updatedAt
      });

      // Add creator as owner member
      await db.insert(indexMembers).values({
        indexId: newIndex[0].id,
        userId: req.user!.id,
        permissions: ['owner'],
        prompt: prompt || null, // Use index prompt as default member prompt
        autoAssign: true
      });

      // Get user information
      const userData = await db.select({
        name: users.name,
        email: users.email,
        avatar: users.avatar
      }).from(users)
        .where(eq(users.id, req.user!.id))
        .limit(1);

      const result = {
        id: newIndex[0].id,
        title: newIndex[0].title,
        permissions: newIndex[0].permissions,
        createdAt: newIndex[0].createdAt,
        updatedAt: newIndex[0].updatedAt,
        user: {
          id: req.user!.id, // Use the requesting user ID as owner
          name: userData[0].name,
          email: userData[0].email,
          avatar: userData[0].avatar
        },
        _count: {
          members: 1 // Now has 1 member (the owner)
        }
      };

      return res.status(201).json({
        message: 'Index created successfully',
        index: result
      });
    } catch (error) {
      console.error('Create index error:', error);
      return res.status(500).json({ error: 'Failed to create index' });
    }
  }
);

// Update index
router.put('/:id',
  authenticatePrivy,
  [
    param('id').isUUID(),
    body('title').optional().trim().isLength({ min: 1, max: 255 }),
    body('prompt').optional().trim(),
    body('permissions').optional().isObject(),
    body('permissions.joinPolicy').optional().isIn(['anyone', 'invite_only']),
    body('permissions.allowGuestVibeCheck').optional().isBoolean(),
  ],
  async (req: AuthRequest, res: Response) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }

      const { id } = req.params;
      const { title, prompt, permissions } = req.body;

      const ownershipCheck = await checkIndexOwnership(id, req.user!.id);
      if (!ownershipCheck.hasAccess) {
        return res.status(ownershipCheck.status!).json({ error: ownershipCheck.error });
      }

      // Handle permissions update if provided
      let updatedPermissions = undefined;
      if (permissions) {
        // Get existing permissions to merge with updates
        const existingIndex = await db.select({
          permissions: indexes.permissions
        }).from(indexes)
          .where(eq(indexes.id, id))
          .limit(1);
        
        const currentPermissions = existingIndex[0]?.permissions || {
          joinPolicy: 'invite_only',
          invitationLink: null,
          allowGuestVibeCheck: false
        };

        updatedPermissions = {
          joinPolicy: permissions.joinPolicy || currentPermissions.joinPolicy,
          allowGuestVibeCheck: permissions.allowGuestVibeCheck !== undefined 
            ? permissions.allowGuestVibeCheck 
            : currentPermissions.allowGuestVibeCheck,
          invitationLink: currentPermissions.invitationLink || (
            permissions.joinPolicy === 'invite_only' 
              ? { code: crypto.randomUUID() }
              : null
          )
        };
      }

      const updateData: any = { updatedAt: new Date() };
      if (title !== undefined) updateData.title = title;
      if (prompt !== undefined) updateData.prompt = prompt || null; // Allow empty string to clear prompt
      if (updatedPermissions !== undefined) updateData.permissions = updatedPermissions;

      const updatedIndex = await db.update(indexes)
        .set(updateData)
        .where(eq(indexes.id, id))
        .returning({
          id: indexes.id,
          title: indexes.title,
          prompt: indexes.prompt,
          permissions: indexes.permissions,
          createdAt: indexes.createdAt,
          updatedAt: indexes.updatedAt
        });

      const result = updatedIndex[0];

      // If index prompt changed, trigger centralized event
      if (prompt !== undefined) {
        Events.Index.onPromptUpdated({
          indexId: id,
          promptChanged: true
        });
      }

      return res.json({
        message: 'Index updated successfully',
        index: result
      });
    } catch (error) {
      console.error('Update index error:', error);
      return res.status(500).json({ error: 'Failed to update index' });
    }
  }
);

// Delete index (soft delete)
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

      const ownershipCheck = await checkIndexOwnership(id, req.user!.id);
      if (!ownershipCheck.hasAccess) {
        return res.status(ownershipCheck.status!).json({ error: ownershipCheck.error });
      }

      await db.update(indexes)
        .set({ 
          deletedAt: new Date(),
          updatedAt: new Date()
        })
        .where(eq(indexes.id, id));

      return res.json({ message: 'Index deleted successfully' });
    } catch (error) {
      console.error('Delete index error:', error);
      return res.status(500).json({ error: 'Failed to delete index' });
    }
  }
);

// Add member to index
router.post('/:id/members',
  authenticatePrivy,
  [
    param('id').isUUID(),
    body('userId').isUUID(),
    body('permissions').isArray(),
    body('permissions.*').isString(),
  ],
  async (req: AuthRequest, res: Response) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }

      const { id } = req.params;
      const { userId, permissions } = req.body;

      const ownershipCheck = await checkIndexOwnership(id, req.user!.id);
      if (!ownershipCheck.hasAccess) {
        return res.status(ownershipCheck.status!).json({ error: ownershipCheck.error });
      }

      // Validate user exists
      const userExists = await db.select({ id: users.id })
        .from(users)
        .where(eq(users.id, userId))
        .limit(1);

      if (userExists.length === 0) {
        return res.status(404).json({ error: 'User not found' });
      }

      // Validate permissions
      const validPermissions = ['owner', 'member'];
      const invalidPermissions = permissions.filter((p: string) => !validPermissions.includes(p));
      if (invalidPermissions.length > 0) {
        return res.status(400).json({ 
          error: 'Invalid permissions',
          invalidPermissions 
        });
      }

      // Check if member already exists
      const existingMember = await db.select({ userId: indexMembers.userId })
        .from(indexMembers)
        .where(and(eq(indexMembers.indexId, id), eq(indexMembers.userId, userId)))
        .limit(1);

      if (existingMember.length > 0) {
        return res.status(400).json({ error: 'User is already a member of this index' });
      }

      // Get index prompt to use as default member prompt
      const indexData = await db.select({ prompt: indexes.prompt })
        .from(indexes)
        .where(eq(indexes.id, id))
        .limit(1);

      // Add member
      await db.insert(indexMembers).values({
        indexId: id,
        userId,
        permissions,
        prompt: indexData[0]?.prompt || null, // Use index prompt as default member prompt
        autoAssign: true // Temporary: always set to true for now
      });

      // Get member details
      const memberData = await db.select({
        id: users.id,
        name: users.name,
        email: users.email,
        avatar: users.avatar,
        permissions: indexMembers.permissions,
        createdAt: indexMembers.createdAt
      }).from(indexMembers)
        .innerJoin(users, eq(indexMembers.userId, users.id))
        .where(and(eq(indexMembers.indexId, id), eq(indexMembers.userId, userId)))
        .limit(1);

      return res.status(201).json({
        message: 'Member added successfully',
        member: memberData[0]
      });
    } catch (error) {
      console.error('Add member error:', error);
      return res.status(500).json({ error: 'Failed to add member' });
    }
  }
);

// Remove member from index
router.delete('/:id/members/:userId',
  authenticatePrivy,
  [
    param('id').isUUID(),
    param('userId').isUUID(),
  ],
  async (req: AuthRequest, res: Response) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }

      const { id, userId } = req.params;

      const ownershipCheck = await checkIndexOwnership(id, req.user!.id);
      if (!ownershipCheck.hasAccess) {
        return res.status(ownershipCheck.status!).json({ error: ownershipCheck.error });
      }

      // Check if member exists
      const existingMember = await db.select({ userId: indexMembers.userId })
        .from(indexMembers)
        .where(and(eq(indexMembers.indexId, id), eq(indexMembers.userId, userId)))
        .limit(1);

      if (existingMember.length === 0) {
        return res.status(404).json({ error: 'Member not found' });
      }

      // Validate ownership change to ensure at least one owner remains
      const ownershipValidation = await validateOwnershipChange(id, userId, []);
      if (!ownershipValidation.canChange) {
        return res.status(400).json({ error: ownershipValidation.error });
      }

      // Remove member
      await db.delete(indexMembers)
        .where(and(eq(indexMembers.indexId, id), eq(indexMembers.userId, userId)));

      return res.json({ message: 'Member removed successfully' });
    } catch (error) {
      console.error('Remove member error:', error);
      return res.status(500).json({ error: 'Failed to remove member' });
    }
  }
);

// Leave index (remove self as member)
router.post('/:id/leave',
  authenticatePrivy,
  [param('id').isUUID()],
  async (req: AuthRequest, res: Response) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }

      const { id } = req.params;

      // Check if user is a member
      const membership = await db.select({ userId: indexMembers.userId })
        .from(indexMembers)
        .where(and(eq(indexMembers.indexId, id), eq(indexMembers.userId, req.user!.id)))
        .limit(1);

      if (membership.length === 0) {
        return res.status(404).json({ error: 'You are not a member of this index' });
      }

      // Validate ownership change to ensure at least one owner remains
      const ownershipValidation = await validateOwnershipChange(id, req.user!.id, []);
      if (!ownershipValidation.canChange) {
        return res.status(400).json({ error: ownershipValidation.error });
      }

      // Remove member
      await db.delete(indexMembers)
        .where(and(eq(indexMembers.indexId, id), eq(indexMembers.userId, req.user!.id)));

      return res.json({ message: 'Successfully left the index' });
    } catch (error) {
      console.error('Leave index error:', error);
      return res.status(500).json({ error: 'Failed to leave index' });
    }
  }
);

// Update member permissions
router.patch('/:id/members/:userId',
  authenticatePrivy,
  [
    param('id').isUUID(),
    param('userId').isUUID(),
    body('permissions').isArray(),
    body('permissions.*').isString(),
  ],
  async (req: AuthRequest, res: Response) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }

      const { id, userId } = req.params;
      const { permissions } = req.body;

      const ownershipCheck = await checkIndexOwnership(id, req.user!.id);
      if (!ownershipCheck.hasAccess) {
        return res.status(ownershipCheck.status!).json({ error: ownershipCheck.error });
      }

      // Validate permissions
      const validPermissions = ['owner', 'member'];
      const invalidPermissions = permissions.filter((p: string) => !validPermissions.includes(p));
      if (invalidPermissions.length > 0) {
        return res.status(400).json({ 
          error: 'Invalid permissions',
          invalidPermissions 
        });
      }

      // Check if member exists
      const existingMember = await db.select({ userId: indexMembers.userId })
        .from(indexMembers)
        .where(and(eq(indexMembers.indexId, id), eq(indexMembers.userId, userId)))
        .limit(1);

      if (existingMember.length === 0) {
        return res.status(404).json({ error: 'Member not found' });
      }

      // Validate ownership change to ensure at least one owner remains
      const ownershipValidation = await validateOwnershipChange(id, userId, permissions);
      if (!ownershipValidation.canChange) {
        return res.status(400).json({ error: ownershipValidation.error });
      }

      // Update member permissions
      await db.update(indexMembers)
        .set({ 
          permissions,
          updatedAt: new Date()
        })
        .where(and(eq(indexMembers.indexId, id), eq(indexMembers.userId, userId)));

      // Get updated member details
      const memberData = await db.select({
        id: users.id,
        name: users.name,
        email: users.email,
        avatar: users.avatar,
        permissions: indexMembers.permissions,
        updatedAt: indexMembers.updatedAt
      }).from(indexMembers)
        .innerJoin(users, eq(indexMembers.userId, users.id))
        .where(and(eq(indexMembers.indexId, id), eq(indexMembers.userId, userId)))
        .limit(1);

      return res.json({
        message: 'Member permissions updated successfully',
        member: memberData[0]
      });
    } catch (error) {
      console.error('Update member permissions error:', error);
      return res.status(500).json({ error: 'Failed to update member permissions' });
    }
  }
);

// Update index permissions (joinPolicy, allowGuestVibeCheck)
router.patch('/:id/permissions',
  authenticatePrivy,
  [
    param('id').isUUID(),
    body('joinPolicy').optional().isIn(['anyone', 'invite_only']),
    body('allowGuestVibeCheck').optional().isBoolean(),
  ],
  async (req: AuthRequest, res: Response) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }

      const { id } = req.params;
      const { joinPolicy, allowGuestVibeCheck } = req.body;

      const ownershipCheck = await checkIndexOwnership(id, req.user!.id);
      if (!ownershipCheck.hasAccess) {
        return res.status(ownershipCheck.status!).json({ error: ownershipCheck.error });
      }

      // Get existing permissions
      const existingIndex = await db.select({
        permissions: indexes.permissions
      }).from(indexes)
        .where(eq(indexes.id, id))
        .limit(1);

      const currentPermissions = existingIndex[0]?.permissions || {
        joinPolicy: 'invite_only',
        invitationLink: null,
        allowGuestVibeCheck: false
      };

      // Update permissions
      const finalJoinPolicy = joinPolicy || currentPermissions.joinPolicy;
      
      // Determine invitation link based on joinPolicy transitions:
      // - Switching TO private (from public): Generate NEW code for security
      // - Switching TO public (from private): Keep existing code for stability
      // - Staying private: Keep existing code
      // - Staying public: Keep existing code
      let invitationLink;
      if (finalJoinPolicy === 'invite_only' && currentPermissions.joinPolicy === 'anyone') {
        // Switching from public to private: generate new code
        invitationLink = { code: crypto.randomUUID() };
      } else {
        // All other cases: preserve existing code or generate if missing
        invitationLink = currentPermissions.invitationLink || { code: crypto.randomUUID() };
      }
      
      const updatedPermissions = {
        joinPolicy: finalJoinPolicy,
        allowGuestVibeCheck: allowGuestVibeCheck !== undefined 
          ? allowGuestVibeCheck 
          : currentPermissions.allowGuestVibeCheck,
        invitationLink
      };

      const updatedIndex = await db.update(indexes)
        .set({
          permissions: updatedPermissions,
          updatedAt: new Date()
        })
        .where(eq(indexes.id, id))
        .returning({
          id: indexes.id,
          title: indexes.title,
          permissions: indexes.permissions,
          createdAt: indexes.createdAt,
          updatedAt: indexes.updatedAt
        });

      const result = updatedIndex[0];

      return res.json({
        message: 'Index permissions updated successfully',
        index: result
      });
    } catch (error) {
      console.error('Update index permissions error:', error);
      return res.status(500).json({ error: 'Failed to update index permissions' });
    }
  }
);

// Regenerate invitation link
router.patch('/:id/regenerate-invitation',
  authenticatePrivy,
  [param('id').isUUID()],
  async (req: AuthRequest, res: Response) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }

      const { id } = req.params;

      const ownershipCheck = await checkIndexOwnership(id, req.user!.id);
      if (!ownershipCheck.hasAccess) {
        return res.status(ownershipCheck.status!).json({ error: ownershipCheck.error });
      }

      // Get existing permissions
      const existingIndex = await db.select({
        permissions: indexes.permissions
      }).from(indexes)
        .where(eq(indexes.id, id))
        .limit(1);

      const currentPermissions = existingIndex[0]?.permissions || {
        joinPolicy: 'invite_only',
        invitationLink: null,
        allowGuestVibeCheck: false
      };

      // Only regenerate if it's invite_only
      if (currentPermissions.joinPolicy !== 'invite_only') {
        return res.status(400).json({ error: 'Can only regenerate invitation links for private networks' });
      }

      // Generate new invitation link
      const updatedPermissions = {
        ...currentPermissions,
        invitationLink: { code: crypto.randomUUID() }
      };

      const updatedIndex = await db.update(indexes)
        .set({
          permissions: updatedPermissions,
          updatedAt: new Date()
        })
        .where(eq(indexes.id, id))
        .returning({
          id: indexes.id,
          title: indexes.title,
          permissions: indexes.permissions,
          createdAt: indexes.createdAt,
          updatedAt: indexes.updatedAt
        });

      const result = updatedIndex[0];

      return res.json({
        message: 'Invitation link regenerated successfully',
        index: result
      });
    } catch (error) {
      console.error('Regenerate invitation link error:', error);
      return res.status(500).json({ error: 'Failed to regenerate invitation link' });
    }
  }
);

// Get members of an index
router.get('/:id/members',
  authenticatePrivy,
  [param('id').isUUID()],
  async (req: AuthRequest, res: Response) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }

      const { id } = req.params;

      const accessCheck = await checkUserIndexAccess(id, req.user!.id);
      if (!accessCheck.hasAccess) {
        return res.status(accessCheck.status!).json({ error: accessCheck.error });
      }

      const members = await db.select({
        id: users.id,
        name: users.name,
        email: users.email,
        avatar: users.avatar,
        permissions: indexMembers.permissions,
        createdAt: indexMembers.createdAt,
        updatedAt: indexMembers.updatedAt
      }).from(indexMembers)
        .innerJoin(users, eq(indexMembers.userId, users.id))
        .where(eq(indexMembers.indexId, id))
        .orderBy(indexMembers.createdAt);

      return res.json({ members });
    } catch (error) {
      console.error('Get members error:', error);
      return res.status(500).json({ error: 'Failed to get members' });
    }
  }
);

// Get member settings for the current user (works for both owners and members)
router.get('/:id/member-settings',
  authenticatePrivy,
  [param('id').isUUID()],
  async (req: AuthRequest, res: Response) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }

      const { id } = req.params;

      // Use existing access control method
      const accessCheck = await checkUserIndexAccess(id, req.user!.id);
      if (!accessCheck.hasAccess) {
        return res.status(accessCheck.status!).json({ error: accessCheck.error });
      }

      const indexData = accessCheck.indexData!;
      const isOwner = accessCheck.permissions?.includes('owner') || false;

      // Get full index data for title and prompt
      const indexInfo = await db.select({
        title: indexes.title,
        prompt: indexes.prompt
      }).from(indexes)
        .where(eq(indexes.id, id))
        .limit(1);

      // Get member-specific settings (works for both owners and regular members)
      const membership = await db.select({
        prompt: indexMembers.prompt,
        autoAssign: indexMembers.autoAssign,
        permissions: indexMembers.permissions
      }).from(indexMembers)
        .where(and(eq(indexMembers.indexId, id), eq(indexMembers.userId, req.user!.id)))
        .limit(1);

      return res.json({
        indexTitle: indexInfo[0].title,
        indexPrompt: indexInfo[0].prompt,
        memberPrompt: membership[0]?.prompt || null,
        autoAssign: membership[0]?.autoAssign || false,
        permissions: membership[0]?.permissions || [],
        isOwner: isOwner
      });
    } catch (error) {
      console.error('Get member settings error:', error);
      return res.status(500).json({ error: 'Failed to fetch member settings' });
    }
  }
);

// Update member settings for the current user (works for both owners and members)
router.put('/:id/member-settings',
  authenticatePrivy,
  [
    param('id').isUUID(),
    body('prompt').optional().trim(),
    body('autoAssign').optional().isBoolean(),
  ],
  async (req: AuthRequest, res: Response) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }

      const { id } = req.params;
      const { prompt, autoAssign } = req.body;

      // Use existing access control method
      const accessCheck = await checkUserIndexAccess(id, req.user!.id);
      if (!accessCheck.hasAccess) {
        return res.status(accessCheck.status!).json({ error: accessCheck.error });
      }

      // Update member settings (works for both owners and regular members)
      const updateData: any = { updatedAt: new Date() };
      if (prompt !== undefined) updateData.prompt = prompt || null;
      if (autoAssign !== undefined) updateData.autoAssign = autoAssign;

      await db.update(indexMembers)
        .set(updateData)
        .where(and(eq(indexMembers.indexId, id), eq(indexMembers.userId, req.user!.id)));

      // If prompt or autoAssign changed, trigger centralized event
      if (prompt !== undefined || autoAssign !== undefined) {
        Events.Member.onSettingsUpdated({
          userId: req.user!.id,
          indexId: id,
          promptChanged: prompt !== undefined,
          autoAssignChanged: autoAssign !== undefined
        });
      }

      return res.json({ message: 'Member settings updated successfully' });
    } catch (error) {
      console.error('Update member settings error:', error);
      return res.status(500).json({ error: 'Failed to update member settings' });
    }
  }
);

// Access public index by ID (public endpoint - only works for public indexes)
router.get('/public/:id',
  [
    param('id').isUUID(),
  ],
  async (req: Request, res: Response) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }

      const { id } = req.params;

      const index = await db.select({
        id: indexes.id,
        title: indexes.title,
        permissions: indexes.permissions,
        createdAt: indexes.createdAt,
        updatedAt: indexes.updatedAt
      }).from(indexes)
        .where(and(eq(indexes.id, id), isNull(indexes.deletedAt)))
        .limit(1);

      if (index.length === 0) {
        return res.status(404).json({ error: 'Index not found' });
      }

      const indexResult = index[0];

      // Only allow access to public indexes
      if (indexResult.permissions?.joinPolicy !== 'anyone') {
        return res.status(403).json({ error: 'This index is private. You need an invitation to join.' });
      }

      // Get member count
      const memberCount = await db.select({ count: count() })
        .from(indexMembers)
        .where(eq(indexMembers.indexId, id));
      
      const result = {
        id: indexResult.id,
        title: indexResult.title,
        createdAt: indexResult.createdAt,
        updatedAt: indexResult.updatedAt,
        permissions: indexResult.permissions,
        _count: {
          members: memberCount[0]?.count || 0
        }
      };

      return res.json({ index: result });
    } catch (error) {
      console.error('Get public index by ID error:', error);
      return res.status(500).json({ error: 'Failed to fetch index' });
    }
  }
);

// Access index by share code (public endpoint)
router.get('/share/:code',
  [
    param('code').isUUID(),
  ],
  async (req: Request, res: Response) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }

      const { code } = req.params;

      // Validate invitation code (does not check user membership)
      const codeValidation = await validateInvitationCode(code);
      if (!codeValidation.valid) {
        return res.status(codeValidation.status!).json({ error: codeValidation.error });
      }

      const indexId = codeValidation.indexId!;

      const index = await db.select({
        id: indexes.id,
        title: indexes.title,
        permissions: indexes.permissions,
        createdAt: indexes.createdAt,
        updatedAt: indexes.updatedAt
      }).from(indexes)
        .where(and(eq(indexes.id, indexId), isNull(indexes.deletedAt)))
        .limit(1);

      if (index.length === 0) {
        return res.status(404).json({ error: 'Index not found' });
      }

      // Get member count
      const memberCount = await db.select({ count: count() })
        .from(indexMembers)
        .where(eq(indexMembers.indexId, indexId));

      const indexResult = index[0];
      
      const result = {
        id: indexResult.id,
        title: indexResult.title,
        createdAt: indexResult.createdAt,
        updatedAt: indexResult.updatedAt,
        permissions: indexResult.permissions,
        _count: {
          members: memberCount[0]?.count || 0
        }
      };

      return res.json({ index: result });
    } catch (error) {
      console.error('Get index by share code error:', error);
      return res.status(500).json({ error: 'Failed to fetch index' });
    }
  }
);

// Join a public index
router.post('/:id/join',
  authenticatePrivy,
  [param('id').isUUID()],
  async (req: AuthRequest, res: Response) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }

      const { id } = req.params;
      const userId = req.user!.id;

      // Check if index exists
      const indexData = await db.select({
        id: indexes.id,
        title: indexes.title,
        prompt: indexes.prompt,
        permissions: indexes.permissions
      }).from(indexes)
        .where(and(eq(indexes.id, id), isNull(indexes.deletedAt)))
        .limit(1);

      if (indexData.length === 0) {
        return res.status(404).json({ error: 'Index not found' });
      }

      const index = indexData[0];

      // Check if index is public
      if (index.permissions?.joinPolicy !== 'anyone') {
        return res.status(403).json({ error: 'This index is private. You need an invitation to join.' });
      }

      // Check if user is already a member
      const existingMember = await db.select({ userId: indexMembers.userId })
        .from(indexMembers)
        .where(and(eq(indexMembers.indexId, id), eq(indexMembers.userId, userId)))
        .limit(1);

      if (existingMember.length > 0) {
        return res.status(200).json({ 
          message: 'You are already a member of this index',
          index: {
            id: index.id,
            title: index.title,
            prompt: index.prompt,
            permissions: index.permissions
          },
          alreadyMember: true
        });
      }

      // Add user as member
      await db.insert(indexMembers).values({
        indexId: id,
        userId,
        permissions: ['member'],
        prompt: index.prompt || null,
        autoAssign: true
      });

      // Get membership details
      const memberData = await db.select({
        indexId: indexMembers.indexId,
        userId: indexMembers.userId,
        permissions: indexMembers.permissions,
        createdAt: indexMembers.createdAt
      }).from(indexMembers)
        .where(and(eq(indexMembers.indexId, id), eq(indexMembers.userId, userId)))
        .limit(1);

      return res.status(201).json({
        message: 'Successfully joined index',
        index: {
          id: index.id,
          title: index.title,
          prompt: index.prompt,
          permissions: index.permissions
        },
        membership: memberData[0],
        alreadyMember: false
      });
    } catch (error) {
      console.error('Join index error:', error);
      return res.status(500).json({ error: 'Failed to join index' });
    }
  }
);

// Accept invitation and join private index
router.post('/invitation/:code/accept',
  authenticatePrivy,
  [param('code').isUUID()],
  async (req: AuthRequest, res: Response) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }

      const { code } = req.params;
      const userId = req.user!.id;

      // Validate invitation code (does not check user membership)
      const codeValidation = await validateInvitationCode(code);
      if (!codeValidation.valid) {
        return res.status(codeValidation.status!).json({ error: codeValidation.error });
      }

      const indexId = codeValidation.indexId!;
      const indexData = codeValidation.indexData!;

      // Double-check this is an invite_only index
      if (indexData.permissions?.joinPolicy !== 'invite_only') {
        return res.status(403).json({ error: 'This invitation link is no longer valid' });
      }

      // Check if user is already a member using real membership check
      const userAccess = await checkUserIndexAccess(indexId, userId);
      
      if (userAccess.hasAccess) {
        // User is already a member, return the index info
        const fullIndex = await db.select({
          id: indexes.id,
          title: indexes.title,
          prompt: indexes.prompt,
          permissions: indexes.permissions,
          createdAt: indexes.createdAt,
          updatedAt: indexes.updatedAt
        }).from(indexes)
          .where(eq(indexes.id, indexId))
          .limit(1);

        const result = {
          id: fullIndex[0].id,
          title: fullIndex[0].title,
          prompt: fullIndex[0].prompt,
          permissions: fullIndex[0].permissions,
          createdAt: fullIndex[0].createdAt,
          updatedAt: fullIndex[0].updatedAt
        };

        return res.json({
          message: 'You are already a member of this index',
          index: result,
          alreadyMember: true
        });
      }

      // Add user as member
      await db.insert(indexMembers).values({
        indexId: indexId,
        userId,
        permissions: ['member'],
        prompt: indexData.prompt || null,
        autoAssign: true
      });

      // Get full index data without owner info
      const fullIndex = await db.select({
        id: indexes.id,
        title: indexes.title,
        prompt: indexes.prompt,
        permissions: indexes.permissions,
        createdAt: indexes.createdAt,
        updatedAt: indexes.updatedAt
      }).from(indexes)
        .where(eq(indexes.id, indexId))
        .limit(1);

      // Get membership details
      const memberData = await db.select({
        indexId: indexMembers.indexId,
        userId: indexMembers.userId,
        permissions: indexMembers.permissions,
        createdAt: indexMembers.createdAt
      }).from(indexMembers)
        .where(and(eq(indexMembers.indexId, indexId), eq(indexMembers.userId, userId)))
        .limit(1);

      const result = {
        id: fullIndex[0].id,
        title: fullIndex[0].title,
        prompt: fullIndex[0].prompt,
        permissions: fullIndex[0].permissions,
        createdAt: fullIndex[0].createdAt,
        updatedAt: fullIndex[0].updatedAt
      };

      return res.status(201).json({
        message: 'Successfully joined index via invitation',
        index: result,
        membership: memberData[0]
      });
    } catch (error) {
      console.error('Accept invitation error:', error);
      return res.status(500).json({ error: 'Failed to accept invitation' });
    }
  }
);

// Remove intent from index
router.delete('/:indexId/intents/:intentId',
  authenticatePrivy,
  [
    param('intentId').isUUID(),
    param('indexId').isUUID(),
  ],
  async (req: AuthRequest, res: Response) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }

      const { intentId, indexId } = req.params;

      // Check if intent exists
      const intent = await db.select({ id: intents.id, userId: intents.userId })
        .from(intents)
        .where(and(eq(intents.id, intentId), isNull(intents.archivedAt)))
        .limit(1);

      if (intent.length === 0) {
        return res.status(404).json({ error: 'Intent not found' });
      }

      // Verify user has intent write access to the index being removed
      const accessCheck = await checkUserIndexAccess(indexId, req.user!.id);
      
      if (!accessCheck.hasAccess) {
        return res.status(accessCheck.status || 403).json({ 
          error: accessCheck.error || 'Access denied'
        });
      }

      // Check if the association exists
      const existingRelation = await db.select({ intentId: intentIndexes.intentId })
        .from(intentIndexes)
        .where(and(
          eq(intentIndexes.intentId, intentId),
          eq(intentIndexes.indexId, indexId)
        ))
        .limit(1);

      if (existingRelation.length === 0) {
        return res.status(404).json({ error: 'Intent-index association not found' });
      }

      // Remove the relationship
      await db.delete(intentIndexes)
        .where(and(
          eq(intentIndexes.intentId, intentId),
          eq(intentIndexes.indexId, indexId)
        ));

      return res.json({
        message: 'Intent removed from index successfully'
      });
    } catch (error) {
      console.error('Remove intent from index error:', error);
      return res.status(500).json({ error: 'Failed to remove intent from index' });
    }
  }
);


// Get intents for a specific index with pagination
router.get('/:indexId/intents',
  authenticatePrivy,
  [
    param('indexId').isUUID(),
    query('page').optional().isInt({ min: 1 }).toInt(),
    query('limit').optional().isInt({ min: 1, max: 100 }).toInt(),
    query('archived').optional().isBoolean(),
  ],
  async (req: AuthRequest, res: Response) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }

      const { indexId } = req.params;
      const page = Number(req.query.page) || 1;
      const limit = Number(req.query.limit) || 10;
      const skip = (page - 1) * limit;
      const showArchived = req.query.archived === 'true';

      // Check access to the index
      const accessCheck = await checkUserIndexAccess(indexId, req.user!.id);
      if (!accessCheck.hasAccess) {
        return res.status(accessCheck.status || 403).json({ error: accessCheck.error });
      }

      // Check if user has member or owner access
      const isOwner = accessCheck.permissions?.includes('owner') || false;
      const isMember = accessCheck.permissions?.includes('member') || false;
      
      if (!isOwner && !isMember) {
        return res.status(403).json({ error: 'Access denied' });
      }

      // Build base conditions for intents in this index
      const baseCondition = and(
        showArchived ? isNotNull(intents.archivedAt) : isNull(intents.archivedAt),
        eq(intentIndexes.indexId, indexId)
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

      // Get intents for this index with pagination
      const [intentsResult, totalResult] = await Promise.all([
        db.select(selectFields).from(intents)
          .innerJoin(users, eq(intents.userId, users.id))
          .innerJoin(intentIndexes, eq(intents.id, intentIndexes.intentId))
          .where(baseCondition)
          .orderBy(desc(intents.createdAt))
          .offset(skip)
          .limit(limit),
        
        db.select({ count: count() }).from(intents)
          .innerJoin(users, eq(intents.userId, users.id))
          .innerJoin(intentIndexes, eq(intents.id, intentIndexes.intentId))
          .where(baseCondition)
      ]);

      // Add index counts for each intent
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
      console.error('Get index intents error:', error);
      return res.status(500).json({ error: 'Failed to fetch index intents' });
    }
  }
);

// Get member intents - returns indexed intents for the current user
router.get('/:id/member-intents',
  authenticatePrivy,
  [param('id').isUUID()],
  async (req: AuthRequest, res: Response) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }

      const { id } = req.params;

      // Use existing access control method
      const accessCheck = await checkUserIndexAccess(id, req.user!.id);
      if (!accessCheck.hasAccess) {
        return res.status(accessCheck.status!).json({ error: accessCheck.error });
      }

      // Get intents that are already in this index for this user
      const indexedIntents = await db.select({
        id: intents.id,
        payload: intents.payload,
        summary: intents.summary,
        createdAt: intents.createdAt
      }).from(intents)
        .innerJoin(intentIndexes, eq(intents.id, intentIndexes.intentId))
        .where(and(
          eq(intentIndexes.indexId, id),
          eq(intents.userId, req.user!.id),
          isNull(intents.archivedAt)
        ))
        .orderBy(desc(intents.createdAt));

      return res.json({ intents: indexedIntents });
    } catch (error) {
      console.error('Get member intents error:', error);
      return res.status(500).json({ error: 'Failed to fetch member intents' });
    }
  }
);

// Get index summary for onboarding
router.get('/:id/summary',
  authenticatePrivy,
  [param('id').isUUID()],
  async (req: AuthRequest, res: Response) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }

      const { id } = req.params;

      // Check if user is the owner of the index
      const ownerCheck = await db.select({
        userId: indexMembers.userId
      }).from(indexMembers)
        .where(and(
          eq(indexMembers.indexId, id),
          eq(indexMembers.userId, req.user!.id),
          sql`'owner' = ANY(${indexMembers.permissions})`
        ))
        .limit(1);

      if (ownerCheck.length === 0) {
        return res.status(403).json({ error: 'Only index owners can view summary' });
      }

      // Get all members
      const membersResult = await db.select({
        userId: users.id,
        userName: users.name,
        userAvatar: users.avatar
      }).from(indexMembers)
        .innerJoin(users, eq(indexMembers.userId, users.id))
        .where(eq(indexMembers.indexId, id))
        .orderBy(desc(indexMembers.createdAt));

      // Get total intent count
      const [intentCountResult] = await db.select({ count: count() })
        .from(intentIndexes)
        .where(eq(intentIndexes.indexId, id));

      // Get example intents (recent ones, limit 5) - only user's intents
      const exampleIntentsResult = await db.select({
        id: intents.id,
        payload: intents.payload,
        summary: intents.summary,
        isIncognito: intents.isIncognito,
        createdAt: intents.createdAt,
        updatedAt: intents.updatedAt
      }).from(intents)
        .innerJoin(intentIndexes, eq(intents.id, intentIndexes.intentId))
        .where(and(
          eq(intentIndexes.indexId, id),
          eq(intents.userId, req.user!.id),
          isNull(intents.archivedAt)
        ))
        .orderBy(desc(intents.createdAt))
        .limit(5);

      const summary = {
        totalIntents: intentCountResult.count,
        exampleIntents: exampleIntentsResult,
        members: membersResult.map(member => ({
          id: member.userId,
          name: member.userName,
          avatar: member.userAvatar
        }))
      };

      return res.json(summary);
    } catch (error) {
      console.error('Get index summary error:', error);
      return res.status(500).json({ error: 'Failed to fetch index summary' });
    }
  }
);

// Add intent to index (works for both owners and members)
router.post('/:id/member-intents/:intentId',
  authenticatePrivy,
  [
    param('id').isUUID(),
    param('intentId').isUUID(),
  ],
  async (req: AuthRequest, res: Response) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }

      const { id, intentId } = req.params;

      // Use existing access control method
      const accessCheck = await checkUserIndexAccess(id, req.user!.id);
      if (!accessCheck.hasAccess) {
        return res.status(accessCheck.status!).json({ error: accessCheck.error });
      }

      const indexData = accessCheck.indexData!;
      const isOwner = accessCheck.permissions?.includes('owner') || false;

      // Check if intent exists and belongs to the user
      const intent = await db.select({ id: intents.id, userId: intents.userId })
        .from(intents)
        .where(and(
          eq(intents.id, intentId),
          eq(intents.userId, req.user!.id),
          isNull(intents.archivedAt)
        ))
        .limit(1);

      if (intent.length === 0) {
        return res.status(404).json({ error: 'Intent not found or does not belong to you' });
      }

      // Check if intent is already in the index
      const existingRelation = await db.select({ intentId: intentIndexes.intentId })
        .from(intentIndexes)
        .where(and(
          eq(intentIndexes.intentId, intentId),
          eq(intentIndexes.indexId, id)
        ))
        .limit(1);

      if (existingRelation.length > 0) {
        return res.status(400).json({ error: 'Intent is already in this index' });
      }

      // Add the intent to the index
      await db.insert(intentIndexes).values({
        intentId,
        indexId: id
      });

      return res.json({ message: 'Intent added to index successfully' });
    } catch (error) {
      console.error('Add member intent error:', error);
      return res.status(500).json({ error: 'Failed to add intent to index' });
    }
  }
);

// Remove intent from index (works for both owners and members)
router.delete('/:id/member-intents/:intentId',
  authenticatePrivy,
  [
    param('id').isUUID(),
    param('intentId').isUUID(),
  ],
  async (req: AuthRequest, res: Response) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }

      const { id, intentId } = req.params;

      // Use existing access control method
      const accessCheck = await checkUserIndexAccess(id, req.user!.id);
      if (!accessCheck.hasAccess) {
        return res.status(accessCheck.status!).json({ error: accessCheck.error });
      }

      const indexData = accessCheck.indexData!;
      const isOwner = accessCheck.permissions?.includes('owner') || false;

      // Check if intent exists and belongs to the user
      const intent = await db.select({ id: intents.id, userId: intents.userId })
        .from(intents)
        .where(and(
          eq(intents.id, intentId),
          eq(intents.userId, req.user!.id)
        ))
        .limit(1);

      if (intent.length === 0) {
        return res.status(404).json({ error: 'Intent not found or does not belong to you' });
      }

      // Remove the intent from the index
      await db.delete(intentIndexes)
        .where(and(
          eq(intentIndexes.intentId, intentId),
          eq(intentIndexes.indexId, id)
        ));

      return res.json({ message: 'Intent removed from index successfully' });
    } catch (error) {
      console.error('Remove member intent error:', error);
      return res.status(500).json({ error: 'Failed to remove intent from index' });
    }
  }
);

export default router; 
