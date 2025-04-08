import { Router, Request, Response } from 'express';
import { body, query, param, validationResult } from 'express-validator';
import prisma from '../lib/db';
import { authenticateToken, requireAdmin, AuthRequest } from '../middleware/auth';

const router = Router();

// Get all indexes with pagination
router.get('/', 
  authenticateToken,
  [
    query('page').optional().isInt({ min: 1 }).toInt(),
    query('limit').optional().isInt({ min: 1, max: 100 }).toInt(),
    query('userId').optional().isUUID(),
    query('search').optional().trim(),
  ],
  async (req: AuthRequest, res: Response) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }

      const page = Number(req.query.page) || 1;
      const limit = Number(req.query.limit) || 10;
      const userId = req.query.userId as string;
      const search = req.query.search as string;
      const skip = (page - 1) * limit;

      const where: any = {};
      
      // Non-admin users can only see their own indexes or indexes they're members of
      if (req.user!.role !== 'ADMIN') {
        where.OR = [
          { userId: req.user!.id },
          { members: { some: { id: req.user!.id } } }
        ];
      } else if (userId) {
        where.userId = userId;
      }

      if (search) {
        where.name = {
          contains: search,
          mode: 'insensitive' as const
        };
      }

      const [indexes, total] = await Promise.all([
        prisma.index.findMany({
          where,
          select: {
            id: true,
            name: true,
            createdAt: true,
            user: {
              select: {
                id: true,
                name: true,
                email: true,
                avatar: true
              }
            },
            members: {
              select: {
                id: true,
                name: true,
                email: true,
                avatar: true
              },
              take: 5
            },
            _count: {
              select: {
                files: true,
                intents: true,
                members: true
              }
            }
          },
          skip,
          take: limit,
          orderBy: { createdAt: 'desc' }
        }),
        prisma.index.count({ where })
      ]);

      res.json({
        indexes,
        pagination: {
          current: page,
          total: Math.ceil(total / limit),
          count: indexes.length,
          totalCount: total
        }
      });
    } catch (error) {
      console.error('Get indexes error:', error);
      res.status(500).json({ error: 'Failed to fetch indexes' });
    }
  }
);

// Get single index by ID
router.get('/:id',
  authenticateToken,
  [param('id').isUUID()],
  async (req: AuthRequest, res: Response) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }

      const { id } = req.params;
      
      const where: any = { id };
      
      // Non-admin users can only see indexes they own or are members of
      if (req.user!.role !== 'ADMIN') {
        where.OR = [
          { userId: req.user!.id },
          { members: { some: { id: req.user!.id } } }
        ];
      }

      const index = await prisma.index.findFirst({
        where,
        select: {
          id: true,
          name: true,
          createdAt: true,
          user: {
            select: {
              id: true,
              name: true,
              email: true,
              avatar: true
            }
          },
          members: {
            select: {
              id: true,
              name: true,
              email: true,
              avatar: true,
              createdAt: true
            },
            orderBy: { name: 'asc' }
          },
          files: {
            select: {
              id: true,
              name: true,
              size: true,
              date: true,
              createdAt: true
            },
            where: { deletedAt: null },
            orderBy: { createdAt: 'desc' },
            take: 10
          },
          intents: {
            select: {
              id: true,
              title: true,
              status: true,
              updatedAt: true,
              user: {
                select: {
                  name: true
                }
              }
            },
            orderBy: { updatedAt: 'desc' },
            take: 10
          }
        }
      });

      if (!index) {
        return res.status(404).json({ error: 'Index not found or access denied' });
      }

      // Check if current user is owner or member
      const isOwner = index.user.id === req.user!.id;
      const isMember = index.members.some(member => member.id === req.user!.id);

      res.json({ 
        index: {
          ...index,
          files: index.files.map(file => ({
            ...file,
            size: file.size.toString() // Convert BigInt to string
          }))
        },
        permissions: {
          isOwner,
          isMember,
          canEdit: isOwner || req.user!.role === 'ADMIN',
          canDelete: isOwner || req.user!.role === 'ADMIN',
          canAddMembers: isOwner || req.user!.role === 'ADMIN'
        }
      });
    } catch (error) {
      console.error('Get index error:', error);
      res.status(500).json({ error: 'Failed to fetch index' });
    }
  }
);

// Create new index
router.post('/',
  authenticateToken,
  [
    body('name').trim().isLength({ min: 2, max: 100 }),
    body('description').optional().trim().isLength({ max: 500 }),
    body('memberIds').optional().isArray(),
    body('memberIds.*').optional().isUUID(),
  ],
  async (req: AuthRequest, res: Response) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }

      const { name, description, memberIds = [] } = req.body;

      // Verify member IDs exist and are valid users
      if (memberIds.length > 0) {
        const validMembers = await prisma.user.findMany({
          where: {
            id: { in: memberIds },
            deletedAt: null
          },
          select: { id: true }
        });

        if (validMembers.length !== memberIds.length) {
          return res.status(400).json({ error: 'Some member IDs are invalid' });
        }
      }

      const index = await prisma.index.create({
        data: {
          name,
          userId: req.user!.id,
          members: {
            connect: memberIds.map((id: string) => ({ id }))
          }
        },
        select: {
          id: true,
          name: true,
          createdAt: true,
          user: {
            select: {
              id: true,
              name: true,
              email: true
            }
          },
          members: {
            select: {
              id: true,
              name: true,
              email: true
            }
          }
        }
      });

      res.status(201).json({
        message: 'Index created successfully',
        index
      });
    } catch (error: any) {
      if (error.code === 'P2002') {
        return res.status(400).json({ error: 'Index with this name already exists for this user' });
      }
      console.error('Create index error:', error);
      res.status(500).json({ error: 'Failed to create index' });
    }
  }
);

// Update index
router.put('/:id',
  authenticateToken,
  [
    param('id').isUUID(),
    body('name').optional().trim().isLength({ min: 2, max: 100 }),
    body('description').optional().trim().isLength({ max: 500 }),
  ],
  async (req: AuthRequest, res: Response) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }

      const { id } = req.params;
      const { name, description } = req.body;

      const where: any = { id };
      // Non-admin users can only update their own indexes
      if (req.user!.role !== 'ADMIN') {
        where.userId = req.user!.id;
      }

      const updateData: any = {};
      if (name !== undefined) updateData.name = name;

      const index = await prisma.index.update({
        where,
        data: updateData,
        select: {
          id: true,
          name: true,
          createdAt: true,
          user: {
            select: {
              id: true,
              name: true,
              email: true
            }
          },
          members: {
            select: {
              id: true,
              name: true,
              email: true
            }
          }
        }
      });

      res.json({
        message: 'Index updated successfully',
        index
      });
    } catch (error: any) {
      if (error.code === 'P2025') {
        return res.status(404).json({ error: 'Index not found or access denied' });
      }
      if (error.code === 'P2002') {
        return res.status(400).json({ error: 'Index with this name already exists for this user' });
      }
      console.error('Update index error:', error);
      res.status(500).json({ error: 'Failed to update index' });
    }
  }
);

// Delete index
router.delete('/:id',
  authenticateToken,
  [param('id').isUUID()],
  async (req: AuthRequest, res: Response) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }

      const { id } = req.params;

      const where: any = { id };
      // Non-admin users can only delete their own indexes
      if (req.user!.role !== 'ADMIN') {
        where.userId = req.user!.id;
      }

      // Check if index has files or intents
      const index = await prisma.index.findUnique({
        where,
        select: {
          _count: {
            select: {
              files: { where: { deletedAt: null } },
              intents: true
            }
          }
        }
      });

      if (!index) {
        return res.status(404).json({ error: 'Index not found or access denied' });
      }

      if (index._count.files > 0 || index._count.intents > 0) {
        return res.status(400).json({ 
          error: 'Cannot delete index with files or intents. Remove them first.',
          hasFiles: index._count.files > 0,
          hasIntents: index._count.intents > 0
        });
      }

      await prisma.index.delete({
        where
      });

      res.json({ message: 'Index deleted successfully' });
    } catch (error: any) {
      if (error.code === 'P2025') {
        return res.status(404).json({ error: 'Index not found or access denied' });
      }
      console.error('Delete index error:', error);
      res.status(500).json({ error: 'Failed to delete index' });
    }
  }
);

// Add member to index
router.post('/:id/members',
  authenticateToken,
  [
    param('id').isUUID(),
    body('userIds').isArray(),
    body('userIds.*').isUUID(),
  ],
  async (req: AuthRequest, res: Response) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }

      const { id } = req.params;
      const { userIds } = req.body;

      const where: any = { id };
      // Non-admin users can only add members to their own indexes
      if (req.user!.role !== 'ADMIN') {
        where.userId = req.user!.id;
      }

      // Verify index exists and user has permission
      const index = await prisma.index.findUnique({
        where,
        select: { id: true, name: true }
      });

      if (!index) {
        return res.status(404).json({ error: 'Index not found or access denied' });
      }

      // Verify all user IDs are valid
      const validUsers = await prisma.user.findMany({
        where: {
          id: { in: userIds },
          deletedAt: null
        },
        select: { id: true, name: true, email: true }
      });

      if (validUsers.length !== userIds.length) {
        return res.status(400).json({ error: 'Some user IDs are invalid' });
      }

      // Add members to index
      const updatedIndex = await prisma.index.update({
        where: { id },
        data: {
          members: {
            connect: userIds.map((userId: string) => ({ id: userId }))
          }
        },
        select: {
          id: true,
          name: true,
          members: {
            select: {
              id: true,
              name: true,
              email: true,
              avatar: true
            }
          }
        }
      });

      res.json({
        message: `Added ${userIds.length} member(s) to index`,
        index: updatedIndex,
        addedUsers: validUsers
      });
    } catch (error: any) {
      if (error.code === 'P2002') {
        return res.status(400).json({ error: 'Some users are already members of this index' });
      }
      console.error('Add members error:', error);
      res.status(500).json({ error: 'Failed to add members' });
    }
  }
);

// Remove member from index
router.delete('/:id/members/:userId',
  authenticateToken,
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

      const where: any = { id };
      // Non-admin users can only remove members from their own indexes
      if (req.user!.role !== 'ADMIN') {
        where.userId = req.user!.id;
      }

      // Verify index exists and user has permission
      const index = await prisma.index.findUnique({
        where,
        select: { id: true, name: true, userId: true }
      });

      if (!index) {
        return res.status(404).json({ error: 'Index not found or access denied' });
      }

      // Prevent removing the owner from their own index
      if (userId === index.userId) {
        return res.status(400).json({ error: 'Cannot remove the owner from their own index' });
      }

      // Remove member from index
      await prisma.index.update({
        where: { id },
        data: {
          members: {
            disconnect: { id: userId }
          }
        }
      });

      res.json({ message: 'Member removed from index successfully' });
    } catch (error) {
      console.error('Remove member error:', error);
      res.status(500).json({ error: 'Failed to remove member' });
    }
  }
);

// Get index statistics
router.get('/:id/stats',
  authenticateToken,
  [param('id').isUUID()],
  async (req: AuthRequest, res: Response) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }

      const { id } = req.params;

      const where: any = { id };
      // Non-admin users can only view stats for indexes they own or are members of
      if (req.user!.role !== 'ADMIN') {
        where.OR = [
          { userId: req.user!.id },
          { members: { some: { id: req.user!.id } } }
        ];
      }

      const index = await prisma.index.findFirst({
        where,
        select: {
          id: true,
          name: true,
          createdAt: true,
          _count: {
            select: {
              files: { where: { deletedAt: null } },
              intents: true,
              members: true
            }
          }
        }
      });

      if (!index) {
        return res.status(404).json({ error: 'Index not found or access denied' });
      }

      // Get file size statistics
      const fileSizeStats = await prisma.file.aggregate({
        where: {
          indexId: id,
          deletedAt: null
        },
        _sum: { size: true },
        _avg: { size: true },
        _max: { size: true }
      });

      // Get recent activity
      const recentFiles = await prisma.file.findMany({
        where: {
          indexId: id,
          deletedAt: null
        },
        select: {
          name: true,
          createdAt: true
        },
        orderBy: { createdAt: 'desc' },
        take: 5
      });

      const recentIntents = await prisma.intent.findMany({
        where: {
          indexes: { some: { id } }
        },
        select: {
          title: true,
          status: true,
          updatedAt: true
        },
        orderBy: { updatedAt: 'desc' },
        take: 5
      });

      res.json({
        index,
        stats: {
          files: {
            count: index._count.files,
            totalSize: fileSizeStats._sum.size?.toString() || '0',
            averageSize: fileSizeStats._avg.size?.toString() || '0',
            maxSize: fileSizeStats._max.size?.toString() || '0'
          },
          intents: {
            count: index._count.intents
          },
          members: {
            count: index._count.members
          }
        },
        recentActivity: {
          files: recentFiles,
          intents: recentIntents
        }
      });
    } catch (error) {
      console.error('Get index stats error:', error);
      res.status(500).json({ error: 'Failed to get index statistics' });
    }
  }
);

export default router; 