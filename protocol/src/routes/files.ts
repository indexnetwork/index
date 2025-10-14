import { Router, Response } from 'express';
import { query, param, validationResult } from 'express-validator';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { v4 as uuidv4 } from 'uuid';
import db from '../lib/db';
import { files } from '../lib/schema';
import { authenticatePrivy, AuthRequest } from '../middleware/auth';
import { eq, isNull, and, count, desc } from 'drizzle-orm';
import { getUploadsPath } from '../lib/paths';
import { processUploadedFiles } from '../lib/file-processing';
import { addGenerateIntentsJob } from '../lib/queue/llm-queue';

// Extend the Request interface to include generatedFileId
declare global {
  namespace Express {
    interface Request {
      generatedFileId?: string;
    }
  }
}

const router = Router();

// Configure multer for file uploads (library scope)
const baseUploadDir = getUploadsPath('files');
if (!fs.existsSync(baseUploadDir)) fs.mkdirSync(baseUploadDir, { recursive: true });

const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    const userId = (req as AuthRequest).user!.id;
    const userDir = getUploadsPath('files', userId);
    if (!fs.existsSync(userDir)) fs.mkdirSync(userDir, { recursive: true });
    cb(null, userDir);
  },
  filename: function (req, file, cb) {
    // Generate UUID that will be used as file ID
    const fileId = uuidv4();
    const extension = path.extname(file.originalname);
    req.generatedFileId = fileId;
    cb(null, fileId + extension);
  }
});

const upload = multer({ 
  storage: storage,
  limits: {
    fileSize: 100 * 1024 * 1024, // 100MB limit
  },
});

// List files (user scoped)
router.get('/', authenticatePrivy, [
  query('page').optional().isInt({ min: 1 }).toInt(),
  query('limit').optional().isInt({ min: 1, max: 100 }).toInt(),
], async (req: AuthRequest, res: Response) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

    const page = Number(req.query.page) || 1;
    const limit = Number(req.query.limit) || 10;
    const skip = (page - 1) * limit;

    const whereCondition = and(isNull(files.deletedAt), eq(files.userId, req.user!.id));
    const [rows, total] = await Promise.all([
      db.select({ id: files.id, name: files.name, size: files.size, type: files.type, createdAt: files.createdAt })
        .from(files)
        .where(whereCondition)
        .orderBy(desc(files.createdAt))
        .offset(skip)
        .limit(limit),
      db.select({ count: count() }).from(files).where(whereCondition)
    ]);

    const data = rows.map(f => ({
      id: f.id,
      name: f.name,
      size: f.size.toString(),
      type: f.type,
      createdAt: f.createdAt,
      url: fileUrl(req.user!.id, f.id, f.name),
    }));

    return res.json({ files: data, pagination: { current: page, total: Math.ceil(total[0].count / limit), count: rows.length, totalCount: total[0].count } });
  } catch (error) {
    console.error('Get files error:', error);
    return res.status(500).json({ error: 'Failed to fetch files' });
  }
});

// Get single file by ID (user scoped)
router.get('/:fileId', authenticatePrivy, [param('fileId').isUUID()],
  async (req: AuthRequest, res: Response) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }

      const { fileId } = req.params;

      const row = await db.select({ id: files.id, name: files.name, size: files.size, type: files.type, createdAt: files.createdAt, updatedAt: files.updatedAt })
        .from(files)
        .where(and(eq(files.id, fileId), eq(files.userId, req.user!.id), isNull(files.deletedAt)))
        .limit(1);

      if (row.length === 0) {
        return res.status(404).json({ error: 'File not found' });
      }

      const result = {
        id: row[0].id,
        name: row[0].name,
        size: row[0].size.toString(),
        type: row[0].type,
        createdAt: row[0].createdAt,
        updatedAt: row[0].updatedAt,
        url: fileUrl(req.user!.id, row[0].id, row[0].name),
      };

      return res.json({ file: result });
    } catch (error) {
      console.error('Get file error:', error);
      return res.status(500).json({ error: 'Failed to fetch file' });
    }
  }
);

// Upload file to user library
router.post('/', authenticatePrivy, upload.single('file'),
  async (req: AuthRequest, res: Response) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }

      if (!req.file) {
        return res.status(400).json({ error: 'No file uploaded' });
      }

      const newFile = await db.insert(files).values({
        id: req.generatedFileId,
        name: req.file.originalname,
        size: BigInt(req.file.size),
        type: req.file.mimetype,
        userId: req.user!.id,
      }).returning({
        id: files.id,
        name: files.name,
        size: files.size,
        type: files.type,
        createdAt: files.createdAt,
        userId: files.userId
      });

      console.log(`✅ File uploaded successfully: ${req.generatedFileId!} (${req.file!.originalname})`);

      generateIntentsForUpload({
        userId: req.user!.id,
        fileRecord: newFile[0],
        multerFile: req.file,
      }).catch((intentError) => {
        console.error('Intent generation after upload failed:', intentError);
      });

      return res.status(201).json({
        message: 'File uploaded successfully',
        file: {
          ...newFile[0],
          size: newFile[0].size.toString(),
          url: fileUrl(req.user!.id, newFile[0].id, newFile[0].name)
        }
      });
    } catch (error) {
      console.error('Upload file error:', error);
      return res.status(500).json({ error: 'Failed to upload file' });
    }
  }
);

// Delete file (soft delete + physical file deletion)
router.delete('/:fileId', authenticatePrivy, [param('fileId').isUUID()],
  async (req: AuthRequest, res: Response) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }

      const { fileId } = req.params;

      // Check if file exists and user has access
      const file = await db.select({ id: files.id, name: files.name, userId: files.userId })
        .from(files)
        .where(and(eq(files.id, fileId), eq(files.userId, req.user!.id), isNull(files.deletedAt)))
        .limit(1);

      if (file.length === 0) {
        return res.status(404).json({ error: 'File not found' });
      }

      if (file[0].userId !== req.user!.id) {
        return res.status(403).json({ error: 'Access denied' });
      }

      // Soft delete in database first
      await db.update(files)
        .set({ 
          deletedAt: new Date(),
          updatedAt: new Date()
        })
        .where(eq(files.id, fileId));

      // Delete physical files from filesystem
      const userDir = getUploadsPath('files', req.user!.id);
      try {
        const filesInDir = fs.existsSync(userDir) ? fs.readdirSync(userDir) : [];
        const fileToDelete = filesInDir.find(filename => filename.startsWith(fileId + '.'));
        if (fileToDelete) {
          const filePath = path.join(userDir, fileToDelete);
          if (fs.existsSync(filePath)) {
            fs.unlinkSync(filePath);
            console.log(`🗑️ Deleted file: ${filePath}`);
          }
        }
      } catch (fsError) {
        console.error(`⚠️ Failed to delete physical file for ${fileId}:`, fsError);
      }
      

      return res.json({ message: 'File deleted successfully' });
    } catch (error) {
      console.error('Delete file error:', error);
      return res.status(500).json({ error: 'Failed to delete file' });
    }
  }
);

export default router; 

function getExt(name: string) {
  const i = name.lastIndexOf('.');
  return i >= 0 ? name.slice(i) : '';
}

function fileUrl(userId: string, fileId: string, name: string) {
  const ext = getExt(name);
  return `/uploads/files/${userId}/${fileId}${ext}`;
}

async function generateIntentsForUpload(options: {
  userId: string;
  fileRecord: {
    id: string;
    name: string;
    type: string;
  };
  multerFile: Express.Multer.File;
}) {
  const { userId, fileRecord, multerFile } = options;
  const content = await processUploadedFiles([multerFile]);
  if (!content.trim()) {
    console.log(`🤖 Skipping intent generation for ${fileRecord.id} (no readable content)`);
    return;
  }

  await addGenerateIntentsJob({
    userId,
    sourceId: fileRecord.id,
    sourceType: 'file',
    content
  }, 8);

  console.log(`🤖 Intent generation queued for ${fileRecord.id}`);
}
