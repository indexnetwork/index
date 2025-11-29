import { Router, Response, Request } from 'express';
import { privyClient } from '../lib/privy';
import { authenticatePrivy, AuthRequest } from '../middleware/auth';
import db from '../lib/db';
import { users } from '../lib/schema';
import { eq, isNull } from 'drizzle-orm';
import { User, UpdateProfileRequest, OnboardingState } from '../types';
import { checkAndTriggerSocialSync } from '../lib/integrations/social-sync';

const router = Router();

// Verify access token and get user info
router.get('/me', authenticatePrivy, async (req: AuthRequest, res: Response) => {
  try {
    const user = await db.select({
      id: users.id,
      privyId: users.privyId,
      name: users.name,
      intro: users.intro,
      avatar: users.avatar,
      location: users.location,
      socials: users.socials,
      onboarding: users.onboarding,
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
    const { name, intro, avatar, location, socials } = req.body;
    
    // Get old socials before update
    const currentUser = await db.select({ socials: users.socials })
      .from(users)
      .where(eq(users.id, req.user!.id))
      .limit(1);
    const oldSocials = currentUser[0]?.socials || null;
    
    const updatedUser = await db.update(users)
      .set({
        ...(name && { name }),
        ...(intro !== undefined && { intro }),
        ...(avatar && { avatar }),
        ...(location !== undefined && { location }),
        ...(socials !== undefined && { socials }),
        updatedAt: new Date()
      })
      .where(eq(users.id, req.user!.id))
      .returning({
        id: users.id,
        privyId: users.privyId,
        name: users.name,
        intro: users.intro,
        avatar: users.avatar,
        location: users.location,
        socials: users.socials,
        onboarding: users.onboarding,
        createdAt: users.createdAt,
        updatedAt: users.updatedAt
      });

    if (updatedUser.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Trigger social sync if socials changed
    if (socials !== undefined) {
      checkAndTriggerSocialSync(req.user!.id, oldSocials, socials);
    }

    return res.json({ user: updatedUser[0] });
  } catch (error) {
    console.error('Update profile error:', error);
    return res.status(500).json({ error: 'Failed to update profile' });
  }
});

// Update onboarding state
router.patch('/onboarding-state', authenticatePrivy, async (req: AuthRequest, res: Response) => {
  try {
    const { completedAt, flow, currentStep, indexId, invitationCode } = req.body;
    
    // Get current onboarding state
    const currentUser = await db.select({
      onboarding: users.onboarding
    }).from(users)
      .where(eq(users.id, req.user!.id))
      .limit(1);
    
    if (currentUser.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    // Merge with existing onboarding state
    const currentOnboarding = (currentUser[0].onboarding || {}) as any;
    const updatedOnboarding = {
      ...currentOnboarding,
      ...(completedAt !== undefined && { completedAt }),
      ...(flow !== undefined && { flow }),
      ...(currentStep !== undefined && { currentStep }),
      ...(indexId !== undefined && { indexId }),
      ...(invitationCode !== undefined && { invitationCode }),
    };
    
    const updatedUser = await db.update(users)
      .set({
        onboarding: updatedOnboarding,
        updatedAt: new Date()
      })
      .where(eq(users.id, req.user!.id))
      .returning({
        id: users.id,
        privyId: users.privyId,
        name: users.name,
        intro: users.intro,
        avatar: users.avatar,
        location: users.location,
        socials: users.socials,
        onboarding: users.onboarding,
        createdAt: users.createdAt,
        updatedAt: users.updatedAt
      });

    if (updatedUser.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    return res.json({ user: updatedUser[0] });
  } catch (error) {
    console.error('Update onboarding state error:', error);
    return res.status(500).json({ error: 'Failed to update onboarding state' });
  }
});

// Get Privy user from their service (for debugging/admin)
router.get('/privy-user', authenticatePrivy, async (req: AuthRequest, res: Response) => {
  try {
    const privyUser = await privyClient.getUserById(req.user!.privyId);
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