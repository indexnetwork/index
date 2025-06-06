import { Router, Response } from 'express';
import { body, query, param, validationResult } from 'express-validator';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import db from '../lib/db';
import { files, indexes, users } from '../lib/schema';
import { authenticateToken, AuthRequest } from '../middleware/auth';
import { eq, isNull, and, count, desc, SQL } from 'drizzle-orm';

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
    const allowedTypes = /jpeg|jpg|png|gif|pdf|doc|docx|txt|csv|xlsx|zip|json|md|mp4|mp3|wav|avi|mov|webm|pptx|ppt|xls|rtf|odt|ods|odp|epub|mobi|azw3|psd|ai|eps|svg|webp|heic|heif|tiff|bmp|ico|cur|apng|webp|mpg|mpeg|3gp|flv|swf|wmv|mid|midi|wma|aac|ogg|wav|flac|m4a|aiff|au|snd|wav|raw|cr2|nef|arw|rw2|dng|tif|tiff|psd|ai|eps|svg|webp|heic|heif|bmp|ico|cur|apng|webp|mpg|mpeg|3gp|flv|swf|wmv|mid|midi|wma|aac|ogg|wav|flac|m4a|aiff|au|snd|wav|raw|cr2|nef|arw|rw2|dng|tif|tiff/;
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

      // If indexId is provided, check user access and filter
      if (indexId) {
        const index = await db.select({ id: indexes.id })
          .from(indexes)
          .where(eq(indexes.id, indexId))
          .limit(1);

        if (index.length === 0) {
          return res.status(404).json({ error: 'Index not found' });
        }
      }

      const whereCondition = indexId 
        ? and(isNull(files.deletedAt), eq(files.indexId, indexId))
        : isNull(files.deletedAt);

      const [filesResult, totalResult] = await Promise.all([
        db.select({
          id: files.id,
          name: files.name,
          size: files.size,
          type: files.type,
          createdAt: files.createdAt,
          updatedAt: files.updatedAt,
          indexId: files.indexId,
          indexTitle: indexes.title,
          userId: indexes.userId,
          userName: users.name,
          userEmail: users.email
        }).from(files)
          .innerJoin(indexes, eq(files.indexId, indexes.id))
          .innerJoin(users, eq(indexes.userId, users.id))
          .where(whereCondition)
          .orderBy(desc(files.createdAt))
          .offset(skip)
          .limit(limit),

        db.select({ count: count() })
          .from(files)
          .where(whereCondition)
      ]);

      const formattedFiles = filesResult.map(file => ({
        id: file.id,
        name: file.name,
        size: file.size,
        type: file.type,
        createdAt: file.createdAt,
        index: {
          id: file.indexId,
          title: file.indexTitle,
          user: {
            id: file.userId,
            name: file.userName,
          }
        }
      }));

      return res.json({
        files: formattedFiles,
        pagination: {
          current: page,
          total: Math.ceil(totalResult[0].count / limit),
          count: filesResult.length,
          totalCount: totalResult[0].count
        }
      });
    } catch (error) {
      console.error('Get files error:', error);
      return res.status(500).json({ error: 'Failed to fetch files' });
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

      const file = await db.select({
        id: files.id,
        name: files.name,
        size: files.size,
        type: files.type,
        createdAt: files.createdAt,
        updatedAt: files.updatedAt,
        indexId: indexes.id,
        indexTitle: indexes.title,
        indexCreatedAt: indexes.createdAt,
        userId: users.id,
        userName: users.name,
        userEmail: users.email,
        userAvatar: users.avatar
      }).from(files)
        .innerJoin(indexes, eq(files.indexId, indexes.id))
        .innerJoin(users, eq(indexes.userId, users.id))
        .where(and(eq(files.id, id), isNull(files.deletedAt)))
        .limit(1);

      if (file.length === 0) {
        return res.status(404).json({ error: 'File not found' });
      }

      const result = {
        id: file[0].id,
        name: file[0].name,
        size: file[0].size,
        type: file[0].type,
        createdAt: file[0].createdAt,
        updatedAt: file[0].updatedAt,
        index: {
          id: file[0].indexId,
          title: file[0].indexTitle,
          createdAt: file[0].indexCreatedAt,
          user: {
            id: file[0].userId,
            name: file[0].userName,
            email: file[0].userEmail,
            avatar: file[0].userAvatar
          }
        }
      };

      return res.json({ file: result });
    } catch (error) {
      console.error('Get file error:', error);
      return res.status(500).json({ error: 'Failed to fetch file' });
    }
  }
);

// Upload file
router.post('/',
  authenticateToken,
  upload.single('file'),
  [
    body('indexId').isUUID(),
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

      const { indexId } = req.body;

      // Check if index exists and user has access
      const index = await db.select({ id: indexes.id, userId: indexes.userId })
        .from(indexes)
        .where(and(eq(indexes.id, indexId), isNull(indexes.deletedAt)))
        .limit(1);

      if (index.length === 0) {
        return res.status(404).json({ error: 'Index not found' });
      }

      if (index[0].userId !== req.user!.id) {
        return res.status(403).json({ error: 'Access denied' });
      }

      const newFile = await db.insert(files).values({
        name: req.file.originalname,
        size: BigInt(req.file.size),
        type: req.file.mimetype,
        indexId: indexId,
      }).returning({
        id: files.id,
        name: files.name,
        size: files.size,
        type: files.type,
        createdAt: files.createdAt
      });

      return res.status(201).json({
        message: 'File uploaded successfully',
        file: newFile[0]
      });
    } catch (error) {
      console.error('Upload file error:', error);
      return res.status(500).json({ error: 'Failed to upload file' });
    }
  }
);

// Delete file (soft delete)
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

      // Check if file exists and user has access
      const file = await db.select({
        id: files.id,
        userId: indexes.userId
      }).from(files)
        .innerJoin(indexes, eq(files.indexId, indexes.id))
        .where(and(eq(files.id, id), isNull(files.deletedAt)))
        .limit(1);

      if (file.length === 0) {
        return res.status(404).json({ error: 'File not found' });
      }

      if (file[0].userId !== req.user!.id) {
        return res.status(403).json({ error: 'Access denied' });
      }

      await db.update(files)
        .set({ 
          deletedAt: new Date(),
          updatedAt: new Date()
        })
        .where(eq(files.id, id));

      return res.json({ message: 'File deleted successfully' });
    } catch (error) {
      console.error('Delete file error:', error);
      return res.status(500).json({ error: 'Failed to delete file' });
    }
  }
);

export default router; 