import { Router, Response, Request } from 'express';
import { body, query, param, validationResult } from 'express-validator';
import db from '../lib/db';
import { indexes, users, files, indexMembers, intentIndexes, intents } from '../lib/schema';
import { authenticatePrivy, AuthRequest } from '../middleware/auth';
import { eq, isNull, isNotNull, and, count, desc, or, ilike, exists } from 'drizzle-orm';
import { checkIndexAccess, checkIndexOwnership, checkIndexAccessByCode } from '../lib/index-access';
import { summarizeIntent } from '../agents/core/intent_summarizer';
import { triggerBrokersOnIntentCreated } from '../agents/context_brokers/connector';
import crypto from 'crypto';



const router = Router();

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

      // Users can only see their own indexes or indexes they're members of
      const whereCondition = and(
        isNull(indexes.deletedAt),
        or(
          eq(indexes.userId, req.user!.id),
          // Check if user is a member of the index
          exists(
            db.select({ indexId: indexMembers.indexId })
              .from(indexMembers)
              .where(and(
                eq(indexMembers.indexId, indexes.id),
                eq(indexMembers.userId, req.user!.id)
              ))
          )
        )
      ) ?? isNull(indexes.deletedAt);

      const [indexesResult, totalResult] = await Promise.all([
        db.select({
          id: indexes.id,
          title: indexes.title,
          linkPermissions: indexes.linkPermissions,
          createdAt: indexes.createdAt,
          updatedAt: indexes.updatedAt,
          userId: indexes.userId,
          userName: users.name,
          userEmail: users.email,
          userAvatar: users.avatar
        }).from(indexes)
          .innerJoin(users, eq(indexes.userId, users.id))
          .where(whereCondition)
          .orderBy(desc(indexes.createdAt))
          .offset(skip)
          .limit(limit),

        db.select({ count: count() })
          .from(indexes)
          .innerJoin(users, eq(indexes.userId, users.id))
          .where(whereCondition)
      ]);

      // Get file counts for each index
      const indexesWithCounts = await Promise.all(
        indexesResult.map(async (index) => {
          const [fileCount, memberCount] = await Promise.all([
            db.select({ count: count() })
              .from(files)
              .where(and(eq(files.indexId, index.id), isNull(files.deletedAt))),
            db.select({ count: count() })
              .from(indexMembers)
              .where(eq(indexMembers.indexId, index.id))
          ]);

          return {
            id: index.id,
            title: index.title,
            linkPermissions: index.linkPermissions,
            createdAt: index.createdAt,
            updatedAt: index.updatedAt,
            user: {
              id: index.userId,
              name: index.userName,
              email: index.userEmail,
              avatar: index.userAvatar
            },
            _count: {
              files: fileCount[0].count,
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

      const accessCheck = await checkIndexAccess(id, req.user!.id);
      if (!accessCheck.hasAccess) {
        return res.status(accessCheck.status!).json({ error: accessCheck.error });
      }

      const index = await db.select({
        id: indexes.id,
        title: indexes.title,
        linkPermissions: indexes.linkPermissions,
        createdAt: indexes.createdAt,
        updatedAt: indexes.updatedAt,
        userId: indexes.userId,
        userName: users.name,
        userEmail: users.email,
        userAvatar: users.avatar
      }).from(indexes)
        .innerJoin(users, eq(indexes.userId, users.id))
        .where(and(eq(indexes.id, id), isNull(indexes.deletedAt)))
        .limit(1);

      // Get related data
      const [indexFiles, indexMembersData, intentCount] = await Promise.all([
        db.select({
          id: files.id,
          name: files.name,
          type: files.type,
          size: files.size,
          createdAt: files.createdAt,
          indexId: files.indexId
        }).from(files)
          .where(and(eq(files.indexId, id), isNull(files.deletedAt)))
          .orderBy(desc(files.createdAt))
          .limit(10),

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
        linkPermissions: indexData.linkPermissions,
        createdAt: indexData.createdAt,
        updatedAt: indexData.updatedAt,
        user: {
          id: indexData.userId,
          name: indexData.userName,
          email: indexData.userEmail,
          avatar: indexData.userAvatar
        },
        files: indexFiles.map(file => ({
          ...file,
          size: file.size.toString()
        })),
        members: indexMembersData.map(member => ({
          id: member.userId,
          name: member.userName,
          email: member.userEmail,
          avatar: member.userAvatar,
          permissions: member.permissions,
          createdAt: member.memberCreatedAt
        })),
        _count: {
          files: indexFiles.length,
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
  ],
  async (req: AuthRequest, res: Response) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }

      const { title } = req.body;

      const newIndex = await db.insert(indexes).values({
        title,
        userId: req.user!.id,
      }).returning({
        id: indexes.id,
        title: indexes.title,
        linkPermissions: indexes.linkPermissions,
        createdAt: indexes.createdAt,
        updatedAt: indexes.updatedAt,
        userId: indexes.userId
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
        linkPermissions: newIndex[0].linkPermissions,
        createdAt: newIndex[0].createdAt,
        updatedAt: newIndex[0].updatedAt,
        user: {
          id: newIndex[0].userId,
          name: userData[0].name,
          email: userData[0].email,
          avatar: userData[0].avatar
        },
        _count: {
          files: 0,
          members: 0
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
    body('linkPermissions').optional().isObject(),
    body('linkPermissions.permissions').optional().isArray(),
    body('linkPermissions.permissions.*').optional().isString(),
    body('linkPermissions.code').optional().isString(),
  ],
  async (req: AuthRequest, res: Response) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }

      const { id } = req.params;
      const { title, linkPermissions } = req.body;

      const ownershipCheck = await checkIndexOwnership(id, req.user!.id);
      if (!ownershipCheck.hasAccess) {
        return res.status(ownershipCheck.status!).json({ error: ownershipCheck.error });
      }

      // Validate link permissions if provided
      if (linkPermissions) {
        if (!linkPermissions.permissions || !Array.isArray(linkPermissions.permissions)) {
          return res.status(400).json({ 
            error: 'linkPermissions must have a permissions array' 
          });
        }
        
        const validLinkPermissions = ['can-match', 'can-view-files', 'can-write-intents'];
        const invalidPermissions = linkPermissions.permissions.filter((p: string) => !validLinkPermissions.includes(p));
        if (invalidPermissions.length > 0) {
          return res.status(400).json({ 
            error: 'Invalid link permissions',
            invalidPermissions 
          });
        }

        // Generate code only if not provided (preserve existing codes)
        if (!linkPermissions.code) {
          // Check for existing code
          const existingIndex = await db.select({
            linkPermissions: indexes.linkPermissions
          }).from(indexes)
            .where(eq(indexes.id, id))
            .limit(1);
          
          const existingCode = existingIndex[0]?.linkPermissions?.code;
          linkPermissions.code = existingCode || crypto.randomUUID();
        }
      }

      const updateData: any = { updatedAt: new Date() };
      if (title !== undefined) updateData.title = title;
      if (linkPermissions !== undefined) updateData.linkPermissions = linkPermissions;

      const updatedIndex = await db.update(indexes)
        .set(updateData)
        .where(eq(indexes.id, id))
        .returning({
          id: indexes.id,
          title: indexes.title,
          linkPermissions: indexes.linkPermissions,
          createdAt: indexes.createdAt,
          updatedAt: indexes.updatedAt,
          userId: indexes.userId
        });

      const result = updatedIndex[0];

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
      const validPermissions = ['can-write', 'can-read', 'can-view-files', 'can-match', 'can-write-intents'];
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

      // Add member
      await db.insert(indexMembers).values({
        indexId: id,
        userId,
        permissions,
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
      const validPermissions = ['can-write', 'can-read', 'can-view-files', 'can-match', 'can-write-intents'];
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

// Update public permissions for direct link sharing
router.patch('/:id/link-permissions',
  authenticatePrivy,
  [
    param('id').isUUID(),
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
      const { permissions } = req.body;

      const ownershipCheck = await checkIndexOwnership(id, req.user!.id);
      if (!ownershipCheck.hasAccess) {
        return res.status(ownershipCheck.status!).json({ error: ownershipCheck.error });
      }

      // Validate link permissions
      const validLinkPermissions = ['can-match', 'can-view-files', 'can-write-intents'];
      const invalidPermissions = permissions.filter((p: string) => !validLinkPermissions.includes(p));
      if (invalidPermissions.length > 0) {
        return res.status(400).json({ 
          error: 'Invalid link permissions',
          invalidPermissions 
        });
      }

      // Get existing index to preserve existing code
      const existingIndex = await db.select({
        linkPermissions: indexes.linkPermissions
      }).from(indexes)
        .where(eq(indexes.id, id))
        .limit(1);

      // Create link permissions object preserving existing code or generating new one
      const existingCode = existingIndex[0]?.linkPermissions?.code;
      const linkPermissions = permissions.length > 0 
        ? { permissions, code: existingCode || crypto.randomUUID() }
        : null;

      const updatedIndex = await db.update(indexes)
        .set({ 
          linkPermissions,
          updatedAt: new Date()
        })
        .where(eq(indexes.id, id))
        .returning({
          id: indexes.id,
          title: indexes.title,
          linkPermissions: indexes.linkPermissions,
          createdAt: indexes.createdAt,
          updatedAt: indexes.updatedAt,
          userId: indexes.userId
        });

      const result = updatedIndex[0];

      return res.json({
        message: 'Link permissions updated successfully',
        index: result
      });
    } catch (error) {
      console.error('Update link permissions error:', error);
      return res.status(500).json({ error: 'Failed to update link permissions' });
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

      const accessCheck = await checkIndexAccess(id, req.user!.id);
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

      const accessCheck = await checkIndexAccessByCode(code);
      if (!accessCheck.hasAccess) {
        return res.status(accessCheck.status!).json({ error: accessCheck.error });
      }


      const indexData = accessCheck.indexData!;

      const index = await db.select({
        id: indexes.id,
        title: indexes.title,
        linkPermissions: indexes.linkPermissions,
        createdAt: indexes.createdAt,
        updatedAt: indexes.updatedAt,
        userId: indexes.userId,
        userName: users.name,
        userEmail: users.email,
        userAvatar: users.avatar
      }).from(indexes)
        .innerJoin(users, eq(indexes.userId, users.id))
        .where(and(eq(indexes.id, indexData.id), isNull(indexes.deletedAt)))
        .limit(1);

      const indexResult = index[0];
      
      // Check if can-view-files permission exists
      const canViewFiles = indexResult.linkPermissions?.permissions?.includes('can-view-files');
      
      let indexFiles: any[] = [];
      if (canViewFiles) {
        indexFiles = await db.select({
          id: files.id,
          name: files.name,
          type: files.type,
          size: files.size,
          createdAt: files.createdAt,
          indexId: files.indexId
        }).from(files)
          .where(and(eq(files.indexId, indexData.id), isNull(files.deletedAt)))
          .orderBy(desc(files.createdAt))
          .limit(10);
      }
      
      const result = {
        id: indexResult.id,
        title: indexResult.title,
        createdAt: indexResult.createdAt,
        updatedAt: indexResult.updatedAt,
        user: {
          id: indexResult.userId,
          name: indexResult.userName,
          avatar: indexResult.userAvatar
        },
        ...(canViewFiles && {
          files: indexFiles.map(file => ({
            ...file,
            size: file.size.toString()
          }))
        }),
        linkPermissions: indexResult.linkPermissions,
        _count: {
          files: indexFiles.length,
        }
      };

      return res.json({ index: result });
    } catch (error) {
      console.error('Get index by share code error:', error);
      return res.status(500).json({ error: 'Failed to fetch index' });
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
      const accessCheck = await checkIndexOwnership(indexId, req.user!.id);
      
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

// Create intent via share code
router.post('/share/:code/intents',
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
      const accessCheck = await checkIndexAccess(indexId, req.user!.id);
      if (!accessCheck.hasAccess) {
        return res.status(accessCheck.status || 403).json({ error: accessCheck.error });
      }

      // Check if user has read permission (owner has all permissions by default)
      const isOwner = accessCheck.indexData?.userId === req.user!.id;
      const hasReadPermission = accessCheck.memberPermissions?.includes('can-read');
      
      if (!isOwner && !hasReadPermission) {
        return res.status(403).json({ error: 'Read access denied' });
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

export default router; 