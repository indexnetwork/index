import { Router, Request, Response } from 'express';
import { body, query, param, validationResult } from 'express-validator';
import prisma from '../lib/db';
import { authenticateToken, AuthRequest } from '../middleware/auth';

const router = Router();

// Get all users (now open to all authenticated users, with pagination)
router.get('/', 
  authenticateToken, 
  [
    query('page').optional().isInt({ min: 1 }).toInt(),
    query('limit').optional().isInt({ min: 1, max: 100 }).toInt(),
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
      const search = req.query.search as string;
      const skip = (page - 1) * limit;

      const where = {
        deletedAt: null,
        ...(search && {
          OR: [
            { name: { contains: search, mode: 'insensitive' as const } },
            { email: { contains: search, mode: 'insensitive' as const } }
          ]
        })
      };

      const [users, total] = await Promise.all([
        prisma.user.findMany({
          where,
          select: {
            id: true,
            email: true,
            name: true,
            avatar: true,
            createdAt: true,
            updatedAt: true,
            _count: {
              select: {
                intents: true,
                indexes: true,
                memberOf: true
              }
            }
          },
          skip,
          take: limit,
          orderBy: { createdAt: 'desc' }
        }),
        prisma.user.count({ where })
      ]);

      res.json({
        users,
        pagination: {
          current: page,
          total: Math.ceil(total / limit),
          count: users.length,
          totalCount: total
        }
      });
    } catch (error) {
      console.error('Get users error:', error);
      res.status(500).json({ error: 'Failed to fetch users' });
    }
  }
);

// Get single user by ID
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
      
      // Users can only see their own data
      if (req.user!.id !== id) {
        return res.status(403).json({ error: 'Access denied' });
      }

      const user = await prisma.user.findUnique({
        where: { id, deletedAt: null },
        select: {
          id: true,
          email: true,
          name: true,
          avatar: true,
          createdAt: true,
          updatedAt: true,
          intents: {
            select: {
              id: true,
              title: true,
              status: true,
              updatedAt: true
            },
            orderBy: { updatedAt: 'desc' },
            take: 5
          },
          indexes: {
            select: {
              id: true,
              name: true,
              createdAt: true,
              _count: { select: { files: true } }
            },
            orderBy: { createdAt: 'desc' },
            take: 5
          },
          memberOf: {
            select: {
              id: true,
              name: true,
              user: { select: { name: true } }
            },
            take: 5
          }
        }
      });

      if (!user) {
        return res.status(404).json({ error: 'User not found' });
      }

      res.json({ user });
    } catch (error) {
      console.error('Get user error:', error);
      res.status(500).json({ error: 'Failed to fetch user' });
    }
  }
);

// Update user
router.put('/:id',
  authenticateToken,
  [
    param('id').isUUID(),
    body('name').optional().trim().isLength({ min: 2, max: 100 }),
    body('avatar').optional().isURL(),
  ],
  async (req: AuthRequest, res: Response) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }

      const { id } = req.params;
      const { name, avatar } = req.body;

      // Users can only update their own data
      if (req.user!.id !== id) {
        return res.status(403).json({ error: 'Access denied' });
      }

      const updateData: any = {};
      if (name !== undefined) updateData.name = name;
      if (avatar !== undefined) updateData.avatar = avatar;

      const user = await prisma.user.update({
        where: { id, deletedAt: null },
        data: updateData,
        select: {
          id: true,
          email: true,
          name: true,
          avatar: true,
          createdAt: true,
          updatedAt: true
        }
      });

      res.json({ 
        message: 'User updated successfully',
        user
      });
    } catch (error: any) {
      if (error.code === 'P2025') {
        return res.status(404).json({ error: 'User not found' });
      }
      console.error('Update user error:', error);
      res.status(500).json({ error: 'Failed to update user' });
    }
  }
);

// Delete user (users can delete their own accounts)
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

      // Users can only delete their own accounts
      if (req.user!.id !== id) {
        return res.status(403).json({ error: 'Access denied' });
      }

      await prisma.user.update({
        where: { id, deletedAt: null },
        data: { deletedAt: new Date() }
      });

      res.json({ message: 'User deleted successfully' });
    } catch (error: any) {
      if (error.code === 'P2025') {
        return res.status(404).json({ error: 'User not found' });
      }
      console.error('Delete user error:', error);
      res.status(500).json({ error: 'Failed to delete user' });
    }
  }
);

export default router; 