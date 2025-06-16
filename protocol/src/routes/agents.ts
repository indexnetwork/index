import { Router, Response } from 'express';
import { body, query, param, validationResult } from 'express-validator';
import { authenticatePrivy, AuthRequest } from '../middleware/auth';
import { agents } from '../lib/schema';
import db from '../lib/db';
import { eq, isNull, desc, count, and } from 'drizzle-orm';

const router = Router();

// Get all agents with pagination
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

      const [agentsResult, totalResult] = await Promise.all([
        db.select()
          .from(agents)
          .where(isNull(agents.deletedAt))
          .orderBy(desc(agents.createdAt))
          .offset(skip)
          .limit(limit),
        db.select({ count: count() })
          .from(agents)
          .where(isNull(agents.deletedAt))
      ]);

      return res.json({
        agents: agentsResult,
        pagination: {
          current: page,
          total: Math.ceil(totalResult[0].count / limit),
          count: agentsResult.length,
          totalCount: totalResult[0].count
        }
      });
    } catch (error) {
      console.error('Get agents error:', error);
      return res.status(500).json({ error: 'Failed to fetch agents' });
    }
  }
);

// Get single agent by ID
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

      const agent = await db.select()
        .from(agents)
        .where(and(eq(agents.id, id), isNull(agents.deletedAt)))
        .limit(1);

      if (!agent.length) {
        return res.status(404).json({ error: 'Agent not found' });
      }

      return res.json({ agent: agent[0] });
    } catch (error) {
      console.error('Get agent error:', error);
      return res.status(500).json({ error: 'Failed to fetch agent' });
    }
  }
);

// Create new agent
router.post('/',
  authenticatePrivy,
  [
    body('name').trim().isLength({ min: 2, max: 100 }),
    body('description').trim().isLength({ min: 2 }),
    body('avatar').isURL(),
  ],
  async (req: AuthRequest, res: Response) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }

      const { name, description, avatar } = req.body;

      const newAgent = await db.insert(agents)
        .values({
          name,
          description,
          avatar
        })
        .returning();

      return res.status(201).json({
        message: 'Agent created successfully',
        agent: newAgent[0]
      });
    } catch (error: any) {
      if (error.code === '23505') { // Unique violation
        return res.status(400).json({ error: 'Agent with this name already exists' });
      }
      console.error('Create agent error:', error);
      return res.status(500).json({ error: 'Failed to create agent' });
    }
  }
);

// Update agent
router.put('/:id',
  authenticatePrivy,
  [
    param('id').isUUID(),
    body('name').optional().trim().isLength({ min: 2, max: 100 }),
    body('description').optional().trim().isLength({ min: 2 }),
    body('avatar').optional().isURL(),
  ],
  async (req: AuthRequest, res: Response) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }

      const { id } = req.params;
      const { name, description, avatar } = req.body;

      const updateData: any = { updatedAt: new Date() };
      if (name !== undefined) updateData.name = name;
      if (description !== undefined) updateData.description = description;
      if (avatar !== undefined) updateData.avatar = avatar;

      const updatedAgent = await db.update(agents)
        .set(updateData)
        .where(and(eq(agents.id, id), isNull(agents.deletedAt)))
        .returning();

      if (!updatedAgent.length) {
        return res.status(404).json({ error: 'Agent not found' });
      }

      return res.json({
        message: 'Agent updated successfully',
        agent: updatedAgent[0]
      });
    } catch (error: any) {
      if (error.code === '23505') { // Unique violation
        return res.status(400).json({ error: 'Agent with this name already exists' });
      }
      console.error('Update agent error:', error);
      return res.status(500).json({ error: 'Failed to update agent' });
    }
  }
);

// Soft delete agent
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

      const result = await db.update(agents)
        .set({ 
          deletedAt: new Date(),
          updatedAt: new Date()
        })
        .where(and(eq(agents.id, id), isNull(agents.deletedAt)))
        .returning();

      if (!result.length) {
        return res.status(404).json({ error: 'Agent not found' });
      }

      return res.json({ message: 'Agent deleted successfully' });
    } catch (error) {
      console.error('Delete agent error:', error);
      return res.status(500).json({ error: 'Failed to delete agent' });
    }
  }
);

export default router; 