import { Router, Response } from 'express';
import { body, param, validationResult } from 'express-validator';
import db from '../lib/db';
import { users } from '../lib/schema';
import { authenticatePrivy, AuthRequest } from '../middleware/auth';
import { eq, isNull, ilike, or, and, count, desc } from 'drizzle-orm';

const router = Router();

// Get single user by ID
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

      const user = await db.select({
        id: users.id,
        email: users.email,
        name: users.name,
        avatar: users.avatar,
        createdAt: users.createdAt,
        updatedAt: users.updatedAt,
      }).from(users)
        .where(and(eq(users.id, id), isNull(users.deletedAt)))
        .limit(1);

      if (user.length === 0) {
        return res.status(404).json({ error: 'User not found' });
      }

      return res.json({ user: user[0] });
    } catch (error) {
      console.error('Get user error:', error);
      return res.status(500).json({ error: 'Failed to fetch user' });
    }
  }
);

// Update user
router.put('/:id',
  authenticatePrivy,
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

      if (req.user!.id !== id) {
        return res.status(403).json({ error: 'Access denied' });
      }

      const updateData: any = { updatedAt: new Date() };
      if (name !== undefined) updateData.name = name;
      if (avatar !== undefined) updateData.avatar = avatar;

      const updatedUser = await db.update(users)
        .set(updateData)
        .where(and(eq(users.id, id), isNull(users.deletedAt)))
        .returning({
          id: users.id,
          email: users.email,
          name: users.name,
          avatar: users.avatar,
          createdAt: users.createdAt,
          updatedAt: users.updatedAt
        });

      if (updatedUser.length === 0) {
        return res.status(404).json({ error: 'User not found' });
      }

      return res.json({ 
        message: 'User updated successfully',
        user: updatedUser[0]
      });
    } catch (error) {
      console.error('Update user error:', error);
      return res.status(500).json({ error: 'Failed to update user' });
    }
  }
);

// Delete user (soft delete)
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

      if (req.user!.id !== id) {
        return res.status(403).json({ error: 'Access denied' });
      }

      const deletedUser = await db.update(users)
        .set({ 
          deletedAt: new Date(),
          updatedAt: new Date()
        })
        .where(and(eq(users.id, id), isNull(users.deletedAt)))
        .returning({ id: users.id });

      if (deletedUser.length === 0) {
        return res.status(404).json({ error: 'User not found' });
      }

      return res.json({ message: 'User deleted successfully' });
    } catch (error) {
      console.error('Delete user error:', error);
      return res.status(500).json({ error: 'Failed to delete user' });
    }
  }
);

export default router; 