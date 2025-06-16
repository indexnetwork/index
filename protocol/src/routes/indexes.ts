import { Router, Response } from 'express';
import { body, query, param, validationResult } from 'express-validator';
import db from '../lib/db';
import { indexes, users, files, indexMembers, intentIndexes } from '../lib/schema';
import { authenticatePrivy, AuthRequest } from '../middleware/auth';
import { eq, isNull, and, count, desc, or, ilike, exists } from 'drizzle-orm';
import { checkIndexAccess, checkIndexOwnership } from '../lib/index-access';



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
          isPublic: indexes.isPublic,
          isDiscoverable: indexes.isDiscoverable,
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
            isPublic: index.isPublic,
            isDiscoverable: index.isDiscoverable,
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
        isPublic: indexes.isPublic,
        isDiscoverable: indexes.isDiscoverable,
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
          createdAt: files.createdAt
        }).from(files)
          .where(and(eq(files.indexId, id), isNull(files.deletedAt)))
          .orderBy(desc(files.createdAt))
          .limit(10),

        db.select({
          userId: indexMembers.userId,
          userName: users.name,
          userEmail: users.email,
          userAvatar: users.avatar
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
        isPublic: indexData.isPublic,
        isDiscoverable: indexData.isDiscoverable,
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
          avatar: member.userAvatar
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
    body('isPublic').optional().isBoolean(),
    body('isDiscoverable').optional().isBoolean(),
  ],
  async (req: AuthRequest, res: Response) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }

      const { title, isPublic = false, isDiscoverable = false } = req.body;

      const newIndex = await db.insert(indexes).values({
        title,
        isPublic,
        isDiscoverable,
        userId: req.user!.id,
      }).returning({
        id: indexes.id,
        title: indexes.title,
        isPublic: indexes.isPublic,
        isDiscoverable: indexes.isDiscoverable,
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
        isPublic: newIndex[0].isPublic,
        isDiscoverable: newIndex[0].isDiscoverable,
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
    body('isPublic').optional().isBoolean(),
    body('isDiscoverable').optional().isBoolean(),
  ],
  async (req: AuthRequest, res: Response) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }

      const { id } = req.params;
      const { title, isPublic, isDiscoverable } = req.body;

      const ownershipCheck = await checkIndexOwnership(id, req.user!.id);
      if (!ownershipCheck.hasAccess) {
        return res.status(ownershipCheck.status!).json({ error: ownershipCheck.error });
      }

      const updateData: any = { updatedAt: new Date() };
      if (title !== undefined) updateData.title = title;
      if (isPublic !== undefined) updateData.isPublic = isPublic;
      if (isDiscoverable !== undefined) updateData.isDiscoverable = isDiscoverable;

      const updatedIndex = await db.update(indexes)
        .set(updateData)
        .where(eq(indexes.id, id))
        .returning({
          id: indexes.id,
          title: indexes.title,
          isPublic: indexes.isPublic,
          isDiscoverable: indexes.isDiscoverable,
          createdAt: indexes.createdAt,
          updatedAt: indexes.updatedAt,
          userId: indexes.userId
        });

      return res.json({
        message: 'Index updated successfully',
        index: updatedIndex[0]
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
  ],
  async (req: AuthRequest, res: Response) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }

      const { id } = req.params;
      const { userId } = req.body;

      const ownershipCheck = await checkIndexOwnership(id, req.user!.id);
      if (!ownershipCheck.hasAccess) {
        return res.status(ownershipCheck.status!).json({ error: ownershipCheck.error });
      }

      // Check if user exists
      const user = await db.select({ id: users.id })
        .from(users)
        .where(and(eq(users.id, userId), isNull(users.deletedAt)))
        .limit(1);

      if (user.length === 0) {
        return res.status(404).json({ error: 'User not found' });
      }

      // Check if membership already exists
      const existingMember = await db.select({ userId: indexMembers.userId })
        .from(indexMembers)
        .where(and(eq(indexMembers.indexId, id), eq(indexMembers.userId, userId)))
        .limit(1);

      if (existingMember.length > 0) {
        return res.status(400).json({ error: 'User is already a member of this index' });
      }

      await db.insert(indexMembers).values({
        indexId: id,
        userId: userId,
      });

      return res.status(201).json({ message: 'Member added successfully' });
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

      // Check if index exists
      const index = await db.select({ id: indexes.id, userId: indexes.userId })
        .from(indexes)
        .where(and(eq(indexes.id, id), isNull(indexes.deletedAt)))
        .limit(1);

      if (index.length === 0) {
        return res.status(404).json({ error: 'Index not found' });
      }

      // Allow either the index owner to remove any member, or users to remove themselves
      const isOwner = index[0].userId === req.user!.id;
      const isSelfRemoval = userId === req.user!.id;

      if (!isOwner && !isSelfRemoval) {
        return res.status(403).json({ error: 'Access denied' });
      }

      const result = await db.delete(indexMembers)
        .where(and(eq(indexMembers.indexId, id), eq(indexMembers.userId, userId)))
        .returning({ userId: indexMembers.userId });

      if (result.length === 0) {
        return res.status(404).json({ error: 'Member not found' });
      }

      return res.json({ message: 'Member removed successfully' });
    } catch (error) {
      console.error('Remove member error:', error);
      return res.status(500).json({ error: 'Failed to remove member' });
    }
  }
);


export default router; 