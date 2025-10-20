import { Request, Response, NextFunction } from 'express';
import { privyClient } from '../lib/privy';
import db from '../lib/db';
import { users } from '../lib/schema';
import { eq, isNull } from 'drizzle-orm';

interface AuthRequest extends Request {
  user?: {
    id: string;
    privyId: string;
    email: string | null;
    name: string;
  };
}

export const authenticatePrivy = async (req: AuthRequest, res: Response, next: NextFunction) => {
  const authHeader = req.headers.authorization;
  const accessToken = authHeader && authHeader.split(' ')[1]; // Bearer TOKEN

  if (!accessToken) {
    return res.status(401).json({ error: 'Access token required' });
  }

  try {
    // Verify the access token with Privy
    const claims = await privyClient.verifyAuthToken(accessToken);
    
    if (!claims || !claims.userId) {
      return res.status(401).json({ error: 'Invalid access token' });
    }

    // Validate userId before making Privy API call
    if (!claims.userId || typeof claims.userId !== 'string') {
      console.error('Invalid userId in claims:', claims.userId);
      return res.status(401).json({ error: 'Invalid user ID in token' });
    }

    // Get user details from Privy
    const privyUser = await privyClient.getUserById(claims.userId);

    // console.log('privyUser', privyUser);
    // Find or create user in our database
    let user = await db.select({
      id: users.id,
      privyId: users.privyId,
      email: users.email,
      name: users.name,
      deletedAt: users.deletedAt
    }).from(users).where(eq(users.privyId, claims.userId)).limit(1);

    if (user.length === 0) {
      // Create new user if not exists
      // Get email from linked accounts - prioritize verified email
      let userEmail = null;

      if (privyUser.email?.address) {
        userEmail = privyUser.email.address;
      }

      if (!userEmail && privyUser.linkedAccounts) {
        for (const account of privyUser.linkedAccounts) {
          if (account.type === 'email' && (account as any).address) {
            userEmail = (account as any).address;
            break;
          }
          else if (account.type === 'google_oauth' && (account as any).email) {
            userEmail = (account as any).email;
            break;
          }
        }
      }
      
      let userName = '';
      for (const account of privyUser.linkedAccounts) {
        if (account && (account as any).name) {
          userName = (account as any).name;
          break;
        }
      }

      // Require an email to create a user
      if (!userEmail) {
        return res.status(400).json({ error: 'Email required from identity provider' });
      }

      try {
        const newUser = await db.insert(users).values({
          privyId: claims.userId,
          email: userEmail,
          name: userName,
          intro: null,
          avatar: null,
          onboarding: {}
        }).returning({
          id: users.id,
          privyId: users.privyId,
          email: users.email,
          name: users.name,
          deletedAt: users.deletedAt
        });
        user = newUser;
      } catch (e: any) {
        if (e && (e.code === '23505' || String(e?.message || '').includes('users_email_unique'))) {
          // Email already exists - user might have changed login method in Privy
          // Find the existing user by email and update their privyId
          const existingUserByEmail = await db.select({
            id: users.id,
            privyId: users.privyId,
            email: users.email,
            name: users.name,
            deletedAt: users.deletedAt
          }).from(users).where(eq(users.email, userEmail)).limit(1);
          
          if (existingUserByEmail.length > 0) {
            // Update the privyId to the new one
            const updated = await db.update(users)
              .set({ 
                privyId: claims.userId,
                updatedAt: new Date()
              })
              .where(eq(users.id, existingUserByEmail[0].id))
              .returning({
                id: users.id,
                privyId: users.privyId,
                email: users.email,
                name: users.name,
                deletedAt: users.deletedAt
              });
            user = updated;
          } else {
            return res.status(409).json({ error: 'Email already in use' });
          }
        } else {
          throw e;
        }
      }
    } else {
      // Update existing user's email if it has changed
      const existingUser = user[0];
      let updatedEmail = existingUser.email;
      
      if (privyUser.email?.address && privyUser.email.address !== existingUser.email) {
        updatedEmail = privyUser.email.address;
        try {
          await db.update(users)
            .set({ 
              email: updatedEmail,
              updatedAt: new Date()
            })
            .where(eq(users.id, existingUser.id));
        } catch (e: any) {
          if (e && (e.code === '23505' || String(e?.message || '').includes('users_email_unique'))) {
            // Another account already has this email; keep existing email unchanged
            updatedEmail = existingUser.email;
          } else {
            throw e;
          }
        }
          
        // Update the user object for the response
        user[0].email = updatedEmail;
      }
    }

    const userData = user[0];

    if (userData.deletedAt) {
      return res.status(401).json({ error: 'Account deactivated' });
    }

    req.user = {
      id: userData.id,
      privyId: userData.privyId,
      email: userData.email,
      name: userData.name
    };

    return next();
  } catch (error) {
    console.error('Privy authentication error:', error);
    
    // Log additional error details for debugging
    if (error && typeof error === 'object') {
      console.error('Error details:', {
        message: (error as any).message,
        cause: (error as any).cause,
        type: (error as any).type,
        stack: (error as any).stack
      });
    }
    
    return res.status(403).json({ error: 'Invalid or expired access token' });
  }
};

export type { AuthRequest }; 
