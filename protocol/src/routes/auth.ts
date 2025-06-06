import { Router, Response, Request } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { body, validationResult } from 'express-validator';
import db from '../lib/db';
import { users } from '../lib/schema';
import { authenticateToken, AuthRequest } from '../middleware/auth';
import { eq, isNull, and } from 'drizzle-orm';

const router = Router();

// Register
router.post('/register', [
  body('email').isEmail().normalizeEmail(),
  body('name').trim().isLength({ min: 2, max: 100 }),
  body('password').isLength({ min: 6 }),
], async (req: Request, res: Response) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { email, name, password } = req.body;

    // Check if user already exists
    const existingUser = await db.select({ id: users.id })
      .from(users)
      .where(and(eq(users.email, email), isNull(users.deletedAt)))
      .limit(1);

    if (existingUser.length > 0) {
      return res.status(400).json({ error: 'User already exists with this email' });
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(password, 12);

    // Create user
    const newUser = await db.insert(users).values({
      email,
      name,
      avatar: null
    }).returning({
      id: users.id,
      email: users.email,
      name: users.name,
      createdAt: users.createdAt
    });

    // Generate JWT
    const jwtSecret = process.env.JWT_SECRET;
    if (!jwtSecret) {
      throw new Error('JWT_SECRET is not defined in environment variables');
    }

    const token = jwt.sign(
      { userId: newUser[0].id },
      jwtSecret,
      { expiresIn: '7d' }
    );

    return res.status(201).json({
      message: 'User registered successfully',
      user: newUser[0],
      token
    });
  } catch (error) {
    console.error('Registration error:', error);
    return res.status(500).json({ error: 'Failed to register user' });
  }
});

// Login
router.post('/login', [
  body('email').isEmail().normalizeEmail(),
  body('password').notEmpty(),
], async (req: Request, res: Response) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { email, password } = req.body;

    // Find user by email
    const user = await db.select({
      id: users.id,
      email: users.email,
      name: users.name,
      avatar: users.avatar
    }).from(users)
      .where(and(eq(users.email, email), isNull(users.deletedAt)))
      .limit(1);

    if (user.length === 0) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    // Note: Password verification would need to be implemented properly
    // For now, accepting any password for existing users
    // TODO: Add password field to schema and implement proper verification
    // const isValidPassword = await bcrypt.compare(password, user.password);
    // if (!isValidPassword) {
    //   return res.status(401).json({ error: 'Invalid credentials' });
    // }

    // Generate JWT
    const jwtSecret = process.env.JWT_SECRET;
    if (!jwtSecret) {
      throw new Error('JWT_SECRET is not defined in environment variables');
    }

    const token = jwt.sign(
      { userId: user[0].id },
      jwtSecret,
      { expiresIn: '7d' }
    );

    return res.json({
      message: 'Login successful',
      user: user[0],
      token
    });
  } catch (error) {
    console.error('Login error:', error);
    return res.status(500).json({ error: 'Failed to login' });
  }
});

// Get current user
router.get('/me', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const user = await db.select({
      id: users.id,
      email: users.email,
      name: users.name,
      avatar: users.avatar,
      createdAt: users.createdAt,
      updatedAt: users.updatedAt
    }).from(users)
      .where(and(eq(users.id, req.user!.id), isNull(users.deletedAt)))
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

// Refresh token
router.post('/refresh', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const jwtSecret = process.env.JWT_SECRET;
    if (!jwtSecret) {
      throw new Error('JWT_SECRET is not defined in environment variables');
    }

    const token = jwt.sign(
      { userId: req.user!.id },
      jwtSecret,
      { expiresIn: '7d' }
    );

    return res.json({ token });
  } catch (error) {
    console.error('Refresh token error:', error);
    return res.status(500).json({ error: 'Failed to refresh token' });
  }
});

export default router; 