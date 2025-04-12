import { Router, Request, Response } from 'express';
import { body, query, param, validationResult } from 'express-validator';
import prisma from '../lib/db';
import { authenticateToken, AuthRequest } from '../middleware/auth';

const router = Router();

// Get all intents with pagination
router.get('/', 
  authenticateToken,
  [
    query('page').optional().isInt({ min: 1 }).toInt(),
    query('limit').optional().isInt({ min: 1, max: 100 }).toInt(),
    query('status').optional().trim(),
    query('userId').optional().isUUID(),
  ],
  async (req: AuthRequest, res: Response) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }

      const page = Number(req.query.page) || 1;
      const limit = Number(req.query.limit) || 10;
      const status = req.query.status as string;
      const userId = req.query.userId as string;
      const skip = (page - 1) * limit;

      const where: any = {};
      
      // Users can filter by userId if provided
      if (userId) {
        where.userId = userId;
      }

      if (status) {
        where.status = status;
      }

      const [intents, total] = await Promise.all([
        prisma.intent.findMany({
          where,
          select: {
            id: true,
            title: true,
            payload: true,
            status: true,
            updatedAt: true,
            user: {
              select: {
                id: true,
                name: true,
                email: true
              }
            },
            indexes: {
              select: {
                id: true,
                name: true
              },
              take: 3
            },
            intentPairs: {
              select: {
                id: true,
                lastEvent: true,
                lastEventTimestamp: true,
                backers: {
                  select: {
                    confidence: true,
                    agent: {
                      select: {
                        name: true,
                        role: true
                      }
                    }
                  }
                }
              },
              take: 5
            }
          },
          skip,
          take: limit,
          orderBy: { updatedAt: 'desc' }
        }),
        prisma.intent.count({ where })
      ]);

      res.json({
        intents,
        pagination: {
          current: page,
          total: Math.ceil(total / limit),
          count: intents.length,
          totalCount: total
        }
      });
    } catch (error) {
      console.error('Get intents error:', error);
      res.status(500).json({ error: 'Failed to fetch intents' });
    }
  }
);

// Get single intent by ID
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

      const intent = await prisma.intent.findUnique({
        where: { id },
        select: {
          id: true,
          title: true,
          payload: true,
          status: true,
          updatedAt: true,
          user: {
            select: {
              id: true,
              name: true,
              email: true,
              avatar: true
            }
          },
          indexes: {
            select: {
              id: true,
              name: true,
              createdAt: true,
              files: {
                select: {
                  id: true,
                  name: true,
                  size: true
                },
                take: 5
              }
            }
          },
          intentPairs: {
            select: {
              id: true,
              lastEvent: true,
              lastEventTimestamp: true,
              intents: {
                select: {
                  id: true,
                  title: true,
                  user: {
                    select: {
                      name: true
                    }
                  }
                }
              },
              backers: {
                select: {
                  id: true,
                  confidence: true,
                  agent: {
                    select: {
                      id: true,
                      name: true,
                      role: true,
                      avatar: true
                    }
                  },
                  createdAt: true
                },
                orderBy: { confidence: 'desc' }
              }
            },
            orderBy: { lastEventTimestamp: 'desc' }
          }
        }
      });

      if (!intent) {
        return res.status(404).json({ error: 'Intent not found' });
      }

      res.json({ intent });
    } catch (error) {
      console.error('Get intent error:', error);
      res.status(500).json({ error: 'Failed to fetch intent' });
    }
  }
);

// Create new intent
router.post('/',
  authenticateToken,
  [
    body('title').trim().isLength({ min: 3, max: 200 }),
    body('payload').trim().isLength({ min: 10, max: 5000 }),
    body('status').optional().trim().isLength({ min: 1, max: 50 }),
    body('indexIds').optional().isArray(),
    body('indexIds.*').optional().isUUID(),
  ],
  async (req: AuthRequest, res: Response) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }

      const { title, payload, status = 'draft', indexIds = [] } = req.body;

      // Verify user owns the indexes they're trying to connect
      if (indexIds.length > 0) {
        const userIndexes = await prisma.index.findMany({
          where: {
            id: { in: indexIds },
            userId: req.user!.id
          },
          select: { id: true }
        });

        if (userIndexes.length !== indexIds.length) {
          return res.status(403).json({ error: 'You can only connect intents to your own indexes' });
        }
      }

      const intent = await prisma.intent.create({
        data: {
          title,
          payload,
          status,
          userId: req.user!.id,
          indexes: {
            connect: indexIds.map((id: string) => ({ id }))
          }
        },
        select: {
          id: true,
          title: true,
          payload: true,
          status: true,
          updatedAt: true,
          user: {
            select: {
              id: true,
              name: true,
              email: true
            }
          },
          indexes: {
            select: {
              id: true,
              name: true
            }
          }
        }
      });

      res.status(201).json({
        message: 'Intent created successfully',
        intent
      });
    } catch (error) {
      console.error('Create intent error:', error);
      res.status(500).json({ error: 'Failed to create intent' });
    }
  }
);

// Update intent
router.put('/:id',
  authenticateToken,
  [
    param('id').isUUID(),
    body('title').optional().trim().isLength({ min: 3, max: 200 }),
    body('payload').optional().trim().isLength({ min: 10, max: 5000 }),
    body('status').optional().trim().isLength({ min: 1, max: 50 }),
    body('indexIds').optional().isArray(),
    body('indexIds.*').optional().isUUID(),
  ],
  async (req: AuthRequest, res: Response) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }

      const { id } = req.params;
      const { title, payload, status, indexIds } = req.body;

      // Users can only update their own intents
      const where: any = { id, userId: req.user!.id };

      // Verify user owns the indexes they're trying to connect
      if (indexIds && indexIds.length > 0) {
        const userIndexes = await prisma.index.findMany({
          where: {
            id: { in: indexIds },
            userId: req.user!.id
          },
          select: { id: true }
        });

        if (userIndexes.length !== indexIds.length) {
          return res.status(403).json({ error: 'You can only connect intents to your own indexes' });
        }
      }

      const updateData: any = {};
      if (title !== undefined) updateData.title = title;
      if (payload !== undefined) updateData.payload = payload;
      if (status !== undefined) updateData.status = status;

      // Handle index connections
      if (indexIds !== undefined) {
        updateData.indexes = {
          set: indexIds.map((id: string) => ({ id }))
        };
      }

      const intent = await prisma.intent.update({
        where,
        data: updateData,
        select: {
          id: true,
          title: true,
          payload: true,
          status: true,
          updatedAt: true,
          user: {
            select: {
              id: true,
              name: true,
              email: true
            }
          },
          indexes: {
            select: {
              id: true,
              name: true
            }
          }
        }
      });

      res.json({
        message: 'Intent updated successfully',
        intent
      });
    } catch (error: any) {
      if (error.code === 'P2025') {
        return res.status(404).json({ error: 'Intent not found or access denied' });
      }
      console.error('Update intent error:', error);
      res.status(500).json({ error: 'Failed to update intent' });
    }
  }
);

// Delete intent
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

      // Users can only delete their own intents
      const where: any = { id, userId: req.user!.id };

      // Check if intent is part of any active intent pairs
      const intentPairs = await prisma.intentPair.findMany({
        where: {
          intents: { some: { id } },
          deletedAt: null
        }
      });

      if (intentPairs.length > 0) {
        return res.status(400).json({ 
          error: 'Cannot delete intent that is part of active intent pairs',
          activePairs: intentPairs.length
        });
      }

      await prisma.intent.delete({
        where
      });

      res.json({ message: 'Intent deleted successfully' });
    } catch (error: any) {
      if (error.code === 'P2025') {
        return res.status(404).json({ error: 'Intent not found or access denied' });
      }
      console.error('Delete intent error:', error);
      res.status(500).json({ error: 'Failed to delete intent' });
    }
  }
);

// Get intent pairs for an intent
router.get('/:id/pairs',
  authenticateToken,
  [
    param('id').isUUID(),
    query('page').optional().isInt({ min: 1 }).toInt(),
    query('limit').optional().isInt({ min: 1, max: 50 }).toInt(),
  ],
  async (req: AuthRequest, res: Response) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }

      const { id } = req.params;
      const page = Number(req.query.page) || 1;
      const limit = Number(req.query.limit) || 10;
      const skip = (page - 1) * limit;

      // Verify user has access to this intent (users can only see pairs for their own intents)
      const intent = await prisma.intent.findUnique({
        where: { 
          id,
          userId: req.user!.id
        },
        select: { id: true }
      });

      if (!intent) {
        return res.status(404).json({ error: 'Intent not found or access denied' });
      }

      const [pairs, total] = await Promise.all([
        prisma.intentPair.findMany({
          where: {
            intents: { some: { id } },
            deletedAt: null
          },
          select: {
            id: true,
            lastEvent: true,
            lastEventTimestamp: true,
            createdAt: true,
            intents: {
              select: {
                id: true,
                title: true,
                user: {
                  select: {
                    name: true
                  }
                }
              }
            },
            backers: {
              select: {
                confidence: true,
                agent: {
                  select: {
                    name: true,
                    role: true
                  }
                }
              },
              orderBy: { confidence: 'desc' },
              take: 3
            }
          },
          skip,
          take: limit,
          orderBy: { lastEventTimestamp: 'desc' }
        }),
        prisma.intentPair.count({
          where: {
            intents: { some: { id } },
            deletedAt: null
          }
        })
      ]);

      res.json({
        pairs,
        pagination: {
          current: page,
          total: Math.ceil(total / limit),
          count: pairs.length,
          totalCount: total
        }
      });
    } catch (error) {
      console.error('Get intent pairs error:', error);
      res.status(500).json({ error: 'Failed to fetch intent pairs' });
    }
  }
);

export default router; 