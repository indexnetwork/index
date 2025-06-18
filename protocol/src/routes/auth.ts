import { Router, Response, Request } from 'express';
import { privyClient } from '../lib/privy';
import { authenticatePrivy, AuthRequest } from '../middleware/auth';
import db from '../lib/db';
import { users } from '../lib/schema';
import { eq, isNull } from 'drizzle-orm';

const router = Router();

// Verify access token and get user info
router.get('/me', authenticatePrivy, async (req: AuthRequest, res: Response) => {
  try {
    const user = await db.select({
      id: users.id,
      privyId: users.privyId,
      email: users.email,
      name: users.name,
      intro: users.intro,
      avatar: users.avatar,
      createdAt: users.createdAt,
      updatedAt: users.updatedAt
    }).from(users)
      .where(eq(users.id, req.user!.id))
      .limit(1);

    if (user.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    return res.json({ user: user[0] });
  } catch (error) {
    console.error('Get user error:', error);
    return res.status(500).json({ error: 'Failed to get user info' });
  }
});

// Update user profile
router.patch('/profile', authenticatePrivy, async (req: AuthRequest, res: Response) => {
  try {
    const { name, intro, avatar } = req.body;
    
    const updatedUser = await db.update(users)
      .set({
        ...(name && { name }),
        ...(intro !== undefined && { intro }),
        ...(avatar && { avatar }),
        updatedAt: new Date()
      })
      .where(eq(users.id, req.user!.id))
      .returning({
        id: users.id,
        privyId: users.privyId,
        email: users.email,
        name: users.name,
        intro: users.intro,
        avatar: users.avatar,
        createdAt: users.createdAt,
        updatedAt: users.updatedAt
      });

    if (updatedUser.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    return res.json({ user: updatedUser[0] });
  } catch (error) {
    console.error('Update profile error:', error);
    return res.status(500).json({ error: 'Failed to update profile' });
  }
});

// Get Privy user from their service (for debugging/admin)
router.get('/privy-user', authenticatePrivy, async (req: AuthRequest, res: Response) => {
  try {
    const privyUser = await privyClient.getUser(req.user!.privyId);
    return res.json({ privyUser });
  } catch (error) {
    console.error('Get Privy user error:', error);
    return res.status(500).json({ error: 'Failed to get Privy user info' });
  }
});

// Delete user account
router.delete('/account', authenticatePrivy, async (req: AuthRequest, res: Response) => {
  try {
    await db.update(users)
      .set({ deletedAt: new Date() })
      .where(eq(users.id, req.user!.id));

    return res.json({ message: 'Account deleted successfully' });
  } catch (error) {
    console.error('Delete account error:', error);
    return res.status(500).json({ error: 'Failed to delete account' });
  }
});

export default router; 