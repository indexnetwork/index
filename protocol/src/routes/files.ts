import { Router, Request, Response } from 'express';
import { body, query, param, validationResult } from 'express-validator';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import prisma from '../lib/db';
import { authenticateToken, AuthRequest } from '../middleware/auth';

const router = Router();

// Configure multer for file uploads
const uploadDir = path.join(__dirname, '../../uploads');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, uploadDir);
  },
  filename: function (req, file, cb) {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, file.fieldname + '-' + uniqueSuffix + path.extname(file.originalname));
  }
});

const upload = multer({ 
  storage: storage,
  limits: {
    fileSize: 100 * 1024 * 1024, // 100MB limit
  },
  fileFilter: function (req, file, cb) {
    // Allow common file types
    const allowedTypes = /jpeg|jpg|png|gif|pdf|doc|docx|txt|csv|xlsx|zip|json|md/;
    const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
    const mimetype = allowedTypes.test(file.mimetype);
    
    if (mimetype && extname) {
      return cb(null, true);
    } else {
      cb(new Error('File type not allowed'));
    }
  }
});

// Get all files with pagination
router.get('/', 
  authenticateToken,
  [
    query('page').optional().isInt({ min: 1 }).toInt(),
    query('limit').optional().isInt({ min: 1, max: 100 }).toInt(),
    query('indexId').optional().isUUID(),
  ],
  async (req: AuthRequest, res: Response) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }

      const page = Number(req.query.page) || 1;
      const limit = Number(req.query.limit) || 10;
      const indexId = req.query.indexId as string;
      const skip = (page - 1) * limit;

      const where: any = {
        deletedAt: null
      };

      // If indexId is provided, check user access and filter
      if (indexId) {
        const index = await prisma.index.findUnique({
          where: { 
            id: indexId,
            ...(req.user!.role !== 'ADMIN' && { userId: req.user!.id })
          },
          select: { id: true }
        });

        if (!index) {
          return res.status(404).json({ error: 'Index not found or access denied' });
        }

        where.indexId = indexId;
      } else if (req.user!.role !== 'ADMIN') {
        // Non-admin users can only see files from their own indexes
        where.index = {
          userId: req.user!.id
        };
      }

      const [files, total] = await Promise.all([
        prisma.file.findMany({
          where,
          select: {
            id: true,
            name: true,
            size: true,
            date: true,
            createdAt: true,
            index: {
              select: {
                id: true,
                name: true,
                user: {
                  select: {
                    id: true,
                    name: true,
                    email: true
                  }
                }
              }
            }
          },
          skip,
          take: limit,
          orderBy: { createdAt: 'desc' }
        }),
        prisma.file.count({ where })
      ]);

      res.json({
        files,
        pagination: {
          current: page,
          total: Math.ceil(total / limit),
          count: files.length,
          totalCount: total
        }
      });
    } catch (error) {
      console.error('Get files error:', error);
      res.status(500).json({ error: 'Failed to fetch files' });
    }
  }
);

// Get single file by ID
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

      const where: any = { 
        id,
        deletedAt: null
      };

      // Non-admin users can only access files from their own indexes
      if (req.user!.role !== 'ADMIN') {
        where.index = {
          userId: req.user!.id
        };
      }

      const file = await prisma.file.findUnique({
        where,
        select: {
          id: true,
          name: true,
          size: true,
          date: true,
          createdAt: true,
          updatedAt: true,
          index: {
            select: {
              id: true,
              name: true,
              createdAt: true,
              user: {
                select: {
                  id: true,
                  name: true,
                  email: true,
                  avatar: true
                }
              }
            }
          }
        }
      });

      if (!file) {
        return res.status(404).json({ error: 'File not found or access denied' });
      }

      res.json({ file });
    } catch (error) {
      console.error('Get file error:', error);
      res.status(500).json({ error: 'Failed to fetch file' });
    }
  }
);

// Upload single file
router.post('/upload',
  authenticateToken,
  upload.single('file'),
  [
    body('indexId').isUUID(),
    body('description').optional().trim().isLength({ max: 500 })
  ],
  async (req: AuthRequest, res: Response) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }

      if (!req.file) {
        return res.status(400).json({ error: 'No file uploaded' });
      }

      const { indexId, description } = req.body;

      // Verify user owns the index
      const index = await prisma.index.findUnique({
        where: { 
          id: indexId,
          userId: req.user!.id
        },
        select: { id: true, name: true }
      });

      if (!index) {
        // Clean up uploaded file if index access denied
        fs.unlinkSync(req.file.path);
        return res.status(403).json({ error: 'Index not found or access denied' });
      }

      const file = await prisma.file.create({
        data: {
          name: req.file.originalname,
          size: BigInt(req.file.size),
          date: new Date(),
          indexId: indexId
        },
        select: {
          id: true,
          name: true,
          size: true,
          date: true,
          createdAt: true,
          index: {
            select: {
              id: true,
              name: true
            }
          }
        }
      });

      res.status(201).json({
        message: 'File uploaded successfully',
        file: {
          ...file,
          size: file.size.toString() // Convert BigInt to string for JSON
        },
        uploadedFile: {
          originalName: req.file.originalname,
          fileName: req.file.filename,
          size: req.file.size,
          mimeType: req.file.mimetype
        }
      });
    } catch (error) {
      // Clean up uploaded file on error
      if (req.file) {
        try {
          fs.unlinkSync(req.file.path);
        } catch (cleanupError) {
          console.error('Error cleaning up file:', cleanupError);
        }
      }
      console.error('Upload file error:', error);
      res.status(500).json({ error: 'Failed to upload file' });
    }
  }
);

// Upload multiple files
router.post('/upload-multiple',
  authenticateToken,
  upload.array('files', 10), // Max 10 files
  [
    body('indexId').isUUID(),
    body('description').optional().trim().isLength({ max: 500 })
  ],
  async (req: AuthRequest, res: Response) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }

      const files = req.files as Express.Multer.File[];
      if (!files || files.length === 0) {
        return res.status(400).json({ error: 'No files uploaded' });
      }

      const { indexId, description } = req.body;

      // Verify user owns the index
      const index = await prisma.index.findUnique({
        where: { 
          id: indexId,
          userId: req.user!.id
        },
        select: { id: true, name: true }
      });

      if (!index) {
        // Clean up uploaded files if index access denied
        files.forEach(file => {
          try {
            fs.unlinkSync(file.path);
          } catch (cleanupError) {
            console.error('Error cleaning up file:', cleanupError);
          }
        });
        return res.status(403).json({ error: 'Index not found or access denied' });
      }

      // Create file records in database
      const fileRecords = await Promise.all(
        files.map(file => 
          prisma.file.create({
            data: {
              name: file.originalname,
              size: BigInt(file.size),
              date: new Date(),
              indexId: indexId
            },
            select: {
              id: true,
              name: true,
              size: true,
              date: true,
              createdAt: true
            }
          })
        )
      );

      res.status(201).json({
        message: `${files.length} files uploaded successfully`,
        files: fileRecords.map(file => ({
          ...file,
          size: file.size.toString() // Convert BigInt to string for JSON
        })),
        uploadedFiles: files.map(file => ({
          originalName: file.originalname,
          fileName: file.filename,
          size: file.size,
          mimeType: file.mimetype
        }))
      });
    } catch (error) {
      // Clean up uploaded files on error
      const files = req.files as Express.Multer.File[];
      if (files) {
        files.forEach(file => {
          try {
            fs.unlinkSync(file.path);
          } catch (cleanupError) {
            console.error('Error cleaning up file:', cleanupError);
          }
        });
      }
      console.error('Upload multiple files error:', error);
      res.status(500).json({ error: 'Failed to upload files' });
    }
  }
);

// Delete file
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

      const where: any = { 
        id,
        deletedAt: null
      };

      // Non-admin users can only delete files from their own indexes
      if (req.user!.role !== 'ADMIN') {
        where.index = {
          userId: req.user!.id
        };
      }

      // Soft delete the file record
      await prisma.file.update({
        where,
        data: { deletedAt: new Date() }
      });

      res.json({ message: 'File deleted successfully' });
    } catch (error: any) {
      if (error.code === 'P2025') {
        return res.status(404).json({ error: 'File not found or access denied' });
      }
      console.error('Delete file error:', error);
      res.status(500).json({ error: 'Failed to delete file' });
    }
  }
);

// Download file
router.get('/:id/download',
  authenticateToken,
  [param('id').isUUID()],
  async (req: AuthRequest, res: Response) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }

      const { id } = req.params;

      const where: any = { 
        id,
        deletedAt: null
      };

      // Non-admin users can only download files from their own indexes
      if (req.user!.role !== 'ADMIN') {
        where.index = {
          userId: req.user!.id
        };
      }

      const file = await prisma.file.findUnique({
        where,
        select: {
          id: true,
          name: true,
          createdAt: true
        }
      });

      if (!file) {
        return res.status(404).json({ error: 'File not found or access denied' });
      }

      // For now, return file metadata (actual file serving would need proper file storage)
      res.json({ 
        message: 'File download endpoint',
        file,
        note: 'TODO: Implement actual file serving from storage'
      });
    } catch (error) {
      console.error('Download file error:', error);
      res.status(500).json({ error: 'Failed to download file' });
    }
  }
);

// Get file statistics for an index
router.get('/stats/:indexId',
  authenticateToken,
  [param('indexId').isUUID()],
  async (req: AuthRequest, res: Response) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }

      const { indexId } = req.params;

      // Verify user has access to this index
      const index = await prisma.index.findUnique({
        where: { 
          id: indexId,
          ...(req.user!.role !== 'ADMIN' && { userId: req.user!.id })
        },
        select: { id: true, name: true }
      });

      if (!index) {
        return res.status(404).json({ error: 'Index not found or access denied' });
      }

      const stats = await prisma.file.aggregate({
        where: {
          indexId,
          deletedAt: null
        },
        _count: { id: true },
        _sum: { size: true }
      });

      res.json({
        index,
        stats: {
          totalFiles: stats._count.id || 0,
          totalSize: stats._sum.size?.toString() || '0',
          totalSizeBytes: Number(stats._sum.size || 0)
        }
      });
    } catch (error) {
      console.error('Get file stats error:', error);
      res.status(500).json({ error: 'Failed to get file statistics' });
    }
  }
);

export default router; 