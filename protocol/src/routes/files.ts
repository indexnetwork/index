import { Router, Response } from 'express';
import { body, query, param, validationResult } from 'express-validator';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { v4 as uuidv4 } from 'uuid';
import db from '../lib/db';
import { files, indexes, users } from '../lib/schema';
import { authenticatePrivy, AuthRequest } from '../middleware/auth';
import { eq, isNull, and, count, desc, SQL } from 'drizzle-orm';
import { summarizeAndSaveFile, isFileSupported } from '../agents/core/file_summarizer';
import { invalidateIndexCache } from './suggestions';
import { checkIndexAccess } from '../lib/index-access';

// Extend the Request interface to include generatedFileId
declare global {
  namespace Express {
    interface Request {
      generatedFileId?: string;
    }
  }
}

const router = Router({ mergeParams: true });

// Configure multer for file uploads
const baseUploadDir = path.join(__dirname, '../../uploads');
if (!fs.existsSync(baseUploadDir)) {
  fs.mkdirSync(baseUploadDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    const indexId = req.params.indexId;
    const indexUploadDir = path.join(baseUploadDir, indexId);
    
    // Ensure the index-specific directory exists
    if (!fs.existsSync(indexUploadDir)) {
      fs.mkdirSync(indexUploadDir, { recursive: true });
    }
    
    cb(null, indexUploadDir);
  },
  filename: function (req, file, cb) {
    // Generate UUID that will be used as file ID
    const fileId = uuidv4();
    const extension = path.extname(file.originalname);
    
    // Store the fileId in the request for later use
    req.generatedFileId = fileId;
    
    cb(null, fileId + extension);
  }
});

const upload = multer({ 
  storage: storage,
  limits: {
    fileSize: 100 * 1024 * 1024, // 100MB limit
  },
  fileFilter: function (req, file, cb) {
    const allowedMimeTypes = {
      'image': ['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/heic', 'image/heif', 'image/tiff', 'image/bmp', 'image/ico', 'image/cur', 'image/apng'],
      'document': ['application/pdf', 'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'text/plain', 'text/csv', 'application/vnd.ms-excel', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'application/zip', 'application/json', 'text/markdown', 'application/vnd.ms-powerpoint', 'application/vnd.openxmlformats-officedocument.presentationml.presentation', 'application/rtf', 'application/vnd.oasis.opendocument.text', 'application/vnd.oasis.opendocument.spreadsheet', 'application/vnd.oasis.opendocument.presentation', 'application/epub+zip', 'application/x-mobipocket-ebook', 'application/vnd.amazon.ebook'],
      'media': ['video/mp4', 'audio/mpeg', 'audio/wav', 'video/x-msvideo', 'video/quicktime', 'video/webm', 'video/mpeg', 'video/3gpp', 'video/x-flv', 'application/x-shockwave-flash', 'video/x-ms-wmv', 'audio/midi', 'audio/x-midi', 'audio/x-ms-wma', 'audio/aac', 'audio/ogg', 'audio/flac', 'audio/x-m4a', 'audio/aiff', 'audio/basic', 'audio/snd'],
      'image-raw': ['image/x-raw', 'image/x-canon-cr2', 'image/x-nikon-nef', 'image/x-sony-arw', 'image/x-panasonic-rw2', 'image/x-adobe-dng', 'image/tiff'],
      'design': ['image/vnd.adobe.photoshop', 'application/postscript', 'image/svg+xml']
    };
    const mimetype = Object.values(allowedMimeTypes).flat().includes(file.mimetype);

    const allowedTypes = /jpeg|jpg|png|gif|pdf|doc|docx|txt|csv|xlsx|zip|json|md|mp4|mp3|wav|avi|mov|webm|pptx|ppt|xls|rtf|odt|ods|odp|epub|mobi|azw3|psd|ai|eps|svg|webp|heic|heif|tiff|bmp|ico|cur|apng|webp|mpg|mpeg|3gp|flv|swf|wmv|mid|midi|wma|aac|ogg|wav|flac|m4a|aiff|au|snd|wav|raw|cr2|nef|arw|rw2|dng|tif|tiff|psd|ai|eps|svg|webp|heic|heif|bmp|ico|cur|apng|webp|mpg|mpeg|3gp|flv|swf|wmv|mid|midi|wma|aac|ogg|wav|flac|m4a|aiff|au|snd|wav|raw|cr2|nef|arw|rw2|dng|tif|tiff/;
    const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());

    if (mimetype && extname) {
      return cb(null, true);
    } else {
      cb(new Error('File type not allowed'));
    }
  }
});

// Get all files for a specific index
router.get('/', 
  authenticatePrivy,
  [
    param('indexId').isUUID(),
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
      const indexId = req.params.indexId;
      const skip = (page - 1) * limit;

      // Check if index exists
      const index = await db.select({ id: indexes.id })
        .from(indexes)
        .where(and(eq(indexes.id, indexId), isNull(indexes.deletedAt)))
        .limit(1);

      if (index.length === 0) {
        return res.status(404).json({ error: 'Index not found' });
      }

      const whereCondition = and(isNull(files.deletedAt), eq(files.indexId, indexId));

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
        size: file.size.toString(),
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

// Get single file by ID within an index
router.get('/:fileId',
  authenticatePrivy,
  [
    param('indexId').isUUID(),
    param('fileId').isUUID()
  ],
  async (req: AuthRequest, res: Response) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }

      const { indexId, fileId } = req.params;

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
        .where(and(
          eq(files.id, fileId), 
          eq(files.indexId, indexId),
          isNull(files.deletedAt),
          isNull(indexes.deletedAt)
        ))
        .limit(1);

      if (file.length === 0) {
        return res.status(404).json({ error: 'File not found' });
      }

      const result = {
        id: file[0].id,
        name: file[0].name,
        size: file[0].size.toString(),
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

// Upload file to specific index
router.post('/',
  authenticatePrivy,
  upload.single('file'),
  [
    param('indexId').isUUID(),
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

      const { indexId } = req.params;

      const ownershipCheck = await checkIndexAccess(indexId, req.user!.id);
      if (!ownershipCheck.hasAccess) {
        return res.status(ownershipCheck.status!).json({ error: ownershipCheck.error });
      }

      const newFile = await db.insert(files).values({
        id: req.generatedFileId,
        name: req.file.originalname,
        size: BigInt(req.file.size),
        type: req.file.mimetype,
        indexId: indexId,
      }).returning({
        id: files.id,
        name: files.name,
        size: files.size,
        type: files.type,
        createdAt: files.createdAt,
        indexId: files.indexId
      });

      // Invalidate suggestions cache since file count changed
      invalidateIndexCache(indexId);

      // Generate summary in background if file type is supported
      const fileId = req.generatedFileId!;
      const filePath = req.file.path;
      
      if (isFileSupported(filePath)) {
        const summaryDir = path.dirname(filePath);
        const startTime = Date.now();
        
        console.log(`🚀 Starting summarization for file ${fileId} (${req.file!.originalname}) at ${new Date().toISOString()}`);
        
        // Run summarization in background without blocking the response
        summarizeAndSaveFile(filePath, fileId, summaryDir)
          .then(result => {
            const endTime = Date.now();
            const duration = endTime - startTime;
            
            if (result.success) {
              console.log(`📝 Summary generated for file ${fileId} (${req.file!.originalname}) at ${new Date().toISOString()} - Duration: ${duration}ms`);
            } else {
              console.warn(`⚠️ Summary generation failed for ${fileId} (${req.file!.originalname}) at ${new Date().toISOString()} - Duration: ${duration}ms:`, result.error);
            }
          })
          .catch(error => {
            const endTime = Date.now();
            const duration = endTime - startTime;
            console.error(`❌ Summary generation error for ${fileId} (${req.file!.originalname}) at ${new Date().toISOString()} - Duration: ${duration}ms:`, error);
          });
      } else {
        const ext = path.extname(req.file!.originalname);
        console.log(`⏭️ Skipping summary for ${fileId} (${req.file!.originalname}): ${ext} files not supported (videos/audio/binaries)`);
      }

      return res.status(201).json({
        message: 'File uploaded successfully',
        file: {
          ...newFile[0],
          size: newFile[0].size.toString()
        }
      });
    } catch (error) {
      console.error('Upload file error:', error);
      return res.status(500).json({ error: 'Failed to upload file' });
    }
  }
);

// Delete file (soft delete + physical file deletion) within an index
router.delete('/:fileId',
  authenticatePrivy,
  [
    param('indexId').isUUID(),
    param('fileId').isUUID()
  ],
  async (req: AuthRequest, res: Response) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }

      const { indexId, fileId } = req.params;

      // Check if file exists and user has access
      const file = await db.select({
        id: files.id,
        name: files.name,
        userId: indexes.userId
      }).from(files)
        .innerJoin(indexes, eq(files.indexId, indexes.id))
        .where(and(
          eq(files.id, fileId),
          eq(files.indexId, indexId),
          isNull(files.deletedAt),
          isNull(indexes.deletedAt)
        ))
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
      const indexUploadDir = path.join(baseUploadDir, indexId);
      
      try {
        // Find and delete the actual file (we need to find it by fileId since we don't know the extension)
        const filesInDir = fs.existsSync(indexUploadDir) ? fs.readdirSync(indexUploadDir) : [];
        const fileToDelete = filesInDir.find(filename => filename.startsWith(fileId + '.'));
        
        if (fileToDelete) {
          const filePath = path.join(indexUploadDir, fileToDelete);
          if (fs.existsSync(filePath)) {
            fs.unlinkSync(filePath);
            console.log(`🗑️ Deleted file: ${filePath}`);
          }
        }

        // Delete the summary file if it exists
        const summaryPath = path.join(indexUploadDir, `${fileId}.summary`);
        if (fs.existsSync(summaryPath)) {
          fs.unlinkSync(summaryPath);
          console.log(`🗑️ Deleted summary: ${summaryPath}`);
        }
      } catch (fsError) {
        console.error(`⚠️ Failed to delete physical files for ${fileId}:`, fsError);
        // Don't fail the request if file system deletion fails - the soft delete already succeeded
      }

      // Invalidate suggestions cache since file count changed
      invalidateIndexCache(indexId);

      return res.json({ message: 'File deleted successfully' });
    } catch (error) {
      console.error('Delete file error:', error);
      return res.status(500).json({ error: 'Failed to delete file' });
    }
  }
);


export default router; 