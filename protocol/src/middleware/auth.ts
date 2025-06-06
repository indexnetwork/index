import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import db from '../lib/db';
import { users } from '../lib/schema';
import { eq, isNull } from 'drizzle-orm';

interface AuthRequest extends Request {
  user?: {
    id: string;
    email: string;
  };
}

export const authenticateToken = async (req: AuthRequest, res: Response, next: NextFunction) => {
  const authHeader = req.headers.authorization;
  const token = authHeader && authHeader.split(' ')[1]; // Bearer TOKEN

  if (!token) {
    return res.status(401).json({ error: 'Access token required' });
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET!) as any;
    
    // Fetch fresh user data
    const user = await db.select({
      id: users.id,
      email: users.email,
      deletedAt: users.deletedAt
    }).from(users).where(eq(users.id, decoded.userId)).limit(1);

    const userData = user[0];

    if (!userData || userData.deletedAt) {
      return res.status(401).json({ error: 'Invalid token' });
    }

    req.user = {
      id: userData.id,
      email: userData.email
    };

    return next();
  } catch (error) {
    console.error('JWT verification error:', error);
    return res.status(403).json({ error: 'Invalid or expired token' });
  }
};

export type { AuthRequest }; 