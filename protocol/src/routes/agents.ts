import { Router, Request, Response } from 'express';
import { body, query, param, validationResult } from 'express-validator';
import prisma from '../lib/db';
import { authenticateToken, AuthRequest } from '../middleware/auth';
import fs from 'fs';
import path from 'path';

const router = Router();

// Load agent specs
const loadAgentSpecs = () => {
  const agentsDir = path.join(__dirname, '../agents');
  const agentSpecs: any[] = [];
  
  if (fs.existsSync(agentsDir)) {
    const files = fs.readdirSync(agentsDir);
    for (const file of files) {
      if (file.endsWith('.json')) {
        try {
          const spec = JSON.parse(fs.readFileSync(path.join(agentsDir, file), 'utf8'));
          agentSpecs.push(spec);
        } catch (error) {
          console.error(`Error loading agent spec ${file}:`, error);
        }
      }
    }
  }
  
  return agentSpecs;
};

// Get all agents with pagination
router.get('/', 
  authenticateToken,
  [
    query('page').optional().isInt({ min: 1 }).toInt(),
    query('limit').optional().isInt({ min: 1, max: 100 }).toInt(),
    query('role').optional().isIn(['USER', 'SYSTEM']),
  ],
  async (req: AuthRequest, res: Response) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }

      const page = Number(req.query.page) || 1;
      const limit = Number(req.query.limit) || 10;
      const role = req.query.role as string;
      const skip = (page - 1) * limit;

      const where = {
        deletedAt: null,
        ...(role && { role })
      };

      const [agents, total] = await Promise.all([
        prisma.agent.findMany({
          where,
          select: {
            id: true,
            name: true,
            role: true,
            avatar: true,
            createdAt: true,
            updatedAt: true,
            _count: {
              select: {
                backers: true
              }
            }
          },
          skip,
          take: limit,
          orderBy: { createdAt: 'desc' }
        }),
        prisma.agent.count({ where })
      ]);

      // Add agent specs info
      const agentSpecs = loadAgentSpecs();
      const agentsWithSpecs = agents.map((agent: any) => ({
        ...agent,
        hasSpec: agentSpecs.some(spec => spec.name === agent.name)
      }));

      res.json({
        agents: agentsWithSpecs,
        pagination: {
          current: page,
          total: Math.ceil(total / limit),
          count: agents.length,
          totalCount: total
        }
      });
    } catch (error) {
      console.error('Get agents error:', error);
      res.status(500).json({ error: 'Failed to fetch agents' });
    }
  }
);

// Get single agent by ID
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

      const agent = await prisma.agent.findUnique({
        where: { id, deletedAt: null },
        select: {
          id: true,
          name: true,
          role: true,
          avatar: true,
          createdAt: true,
          updatedAt: true,
          backers: {
            select: {
              id: true,
              confidence: true,
              intentPair: {
                select: {
                  id: true,
                  lastEvent: true,
                  lastEventTimestamp: true
                }
              },
              createdAt: true
            },
            orderBy: { createdAt: 'desc' },
            take: 10
          }
        }
      });

      if (!agent) {
        return res.status(404).json({ error: 'Agent not found' });
      }

      // Try to load agent spec
      const agentSpecs = loadAgentSpecs();
      const agentSpec = agentSpecs.find(spec => spec.name === agent.name);

      res.json({ 
        agent: {
          ...agent,
          spec: agentSpec || null
        }
      });
    } catch (error) {
      console.error('Get agent error:', error);
      res.status(500).json({ error: 'Failed to fetch agent' });
    }
  }
);

// Create new agent (now open to all authenticated users)
router.post('/',
  authenticateToken,
  [
    body('name').trim().isLength({ min: 2, max: 100 }),
    body('role').isIn(['USER', 'SYSTEM']),
    body('avatar').isURL(),
  ],
  async (req: AuthRequest, res: Response) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }

      const { name, role, avatar } = req.body;

      const agent = await prisma.agent.create({
        data: {
          name,
          role,
          avatar
        },
        select: {
          id: true,
          name: true,
          role: true,
          avatar: true,
          createdAt: true,
          updatedAt: true
        }
      });

      res.status(201).json({
        message: 'Agent created successfully',
        agent
      });
    } catch (error: any) {
      if (error.code === 'P2002') {
        return res.status(400).json({ error: 'Agent with this name already exists' });
      }
      console.error('Create agent error:', error);
      res.status(500).json({ error: 'Failed to create agent' });
    }
  }
);

// Update agent (now open to all authenticated users)
router.put('/:id',
  authenticateToken,
  [
    param('id').isUUID(),
    body('name').optional().trim().isLength({ min: 2, max: 100 }),
    body('role').optional().isIn(['USER', 'SYSTEM']),
    body('avatar').optional().isURL(),
  ],
  async (req: AuthRequest, res: Response) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }

      const { id } = req.params;
      const { name, role, avatar } = req.body;

      const updateData: any = {};
      if (name !== undefined) updateData.name = name;
      if (role !== undefined) updateData.role = role;
      if (avatar !== undefined) updateData.avatar = avatar;

      const agent = await prisma.agent.update({
        where: { id, deletedAt: null },
        data: updateData,
        select: {
          id: true,
          name: true,
          role: true,
          avatar: true,
          createdAt: true,
          updatedAt: true
        }
      });

      res.json({
        message: 'Agent updated successfully',
        agent
      });
    } catch (error: any) {
      if (error.code === 'P2025') {
        return res.status(404).json({ error: 'Agent not found' });
      }
      console.error('Update agent error:', error);
      res.status(500).json({ error: 'Failed to update agent' });
    }
  }
);

// Soft delete agent (now open to all authenticated users)
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

      await prisma.agent.update({
        where: { id, deletedAt: null },
        data: { deletedAt: new Date() }
      });

      res.json({ message: 'Agent deleted successfully' });
    } catch (error: any) {
      if (error.code === 'P2025') {
        return res.status(404).json({ error: 'Agent not found' });
      }
      console.error('Delete agent error:', error);
      res.status(500).json({ error: 'Failed to delete agent' });
    }
  }
);

// Get agent specs (metadata about available agents)
router.get('/specs/list', 
  authenticateToken,
  async (req: AuthRequest, res: Response) => {
    try {
      const agentSpecs = loadAgentSpecs();
      res.json({ specs: agentSpecs });
    } catch (error) {
      console.error('Get agent specs error:', error);
      res.status(500).json({ error: 'Failed to load agent specs' });
    }
  }
);

export default router; 