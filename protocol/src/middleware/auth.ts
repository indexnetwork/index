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

    // Get user details from Privy
    const privyUser = await privyClient.getUser(claims.userId);

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
      let userName = `User ${claims.userId.slice(-8)}`;
      
      if (privyUser.email?.address) {
        userEmail = privyUser.email.address;
        userName = privyUser.email.address;
      }
      
      // If we have linked accounts, try to find an email there
      if (!userEmail && privyUser.linkedAccounts) {
        for (const account of privyUser.linkedAccounts) {
          if (account.type === 'email' && account.address) {
            userEmail = account.address;
            userName = account.address;
            break;
          }
        }
      }

      const newUser = await db.insert(users).values({
        privyId: claims.userId,
        email: userEmail,
        name: userName,
        intro: null,
        avatar: null
      }).returning({
        id: users.id,
        privyId: users.privyId,
        email: users.email,
        name: users.name,
        deletedAt: users.deletedAt
      });
      
      user = newUser;
    } else {
      // Update existing user's email if it has changed
      const existingUser = user[0];
      let updatedEmail = existingUser.email;
      
      if (privyUser.email?.address && privyUser.email.address !== existingUser.email) {
        updatedEmail = privyUser.email.address;
        
        await db.update(users)
          .set({ 
            email: updatedEmail,
            updatedAt: new Date()
          })
          .where(eq(users.id, existingUser.id));
          
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
    return res.status(403).json({ error: 'Invalid or expired access token' });
  }
};

export type { AuthRequest }; 