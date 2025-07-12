import { Router, Response, Request } from 'express';
import { param, validationResult } from 'express-validator';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { v4 as uuidv4 } from 'uuid';
import db from '../lib/db';
import { intents, users, intentIndexes } from '../lib/schema';
import { eq } from 'drizzle-orm';
import { checkIndexAccessByCode } from '../lib/index-access';
import { vibeCheck } from '../agents/external/vibe_checker_text';
import { processUploadedFiles } from '../lib/file-processing';

const router = Router();

// Configure multer for temporary file uploads
const tempUploadDir = path.join(__dirname, '../../uploads/temp');
if (!fs.existsSync(tempUploadDir)) {
  fs.mkdirSync(tempUploadDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, tempUploadDir);
  },
  filename: function (req, file, cb) {
    // Generate unique filename
    const uniqueName = uuidv4() + path.extname(file.originalname);
    cb(null, uniqueName);
  }
});

const upload = multer({ 
  storage: storage,
  limits: {
    fileSize: 100 * 1024 * 1024, // 100MB limit
    files: 10 // Max 10 files
  },
  fileFilter: function (req, file, cb) {
    const allowedMimeTypes = [
      'application/pdf', 'application/msword', 
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'text/plain', 'text/csv', 'application/vnd.ms-excel',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'application/json', 'text/markdown', 
      'application/vnd.ms-powerpoint',
      'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      'application/rtf'
    ];
    
    const allowedTypes = /pdf|doc|docx|txt|csv|xlsx|xls|json|md|ppt|pptx|rtf/;
    const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
    const mimetype = allowedMimeTypes.includes(file.mimetype);

    if (mimetype && extname) {
      return cb(null, true);
    } else {
      cb(new Error('File type not allowed'));
    }
  }
});

// Cleanup function to remove temporary files
const cleanupTempFiles = (files: Express.Multer.File[]) => {
  files.forEach(file => {
    try {
      if (fs.existsSync(file.path)) {
        fs.unlinkSync(file.path);
      }
    } catch (error) {
      console.warn(`Failed to cleanup temp file ${file.path}:`, error);
    }
  });
};

// Cleanup old temp files (24 hours)
const cleanupOldTempFiles = () => {
  try {
    const files = fs.readdirSync(tempUploadDir);
    const now = Date.now();
    const maxAge = 24 * 60 * 60 * 1000; // 24 hours

    files.forEach(file => {
      const filePath = path.join(tempUploadDir, file);
      const stats = fs.statSync(filePath);
      
      if (now - stats.mtime.getTime() > maxAge) {
        fs.unlinkSync(filePath);
      }
    });
  } catch (error) {
    console.warn('Cleanup failed:', error);
  }
};

// Run cleanup every hour
setInterval(cleanupOldTempFiles, 60 * 60 * 1000);

// Unauthenticated vibe check endpoint
router.post('/share/:code',
  upload.array('files', 10),
  [
    param('code').isUUID()
  ],
  async (req: Request, res: Response) => {
    const uploadedFiles = req.files as Express.Multer.File[];
    
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        cleanupTempFiles(uploadedFiles || []);
        return res.status(400).json({ errors: errors.array() });
      }

      const { code } = req.params;

      if (!uploadedFiles || uploadedFiles.length === 0) {
        return res.status(400).json({ error: 'No files uploaded' });
      }

      // Check access to the shared index
      const accessCheck = await checkIndexAccessByCode(code);
      if (!accessCheck.hasAccess) {
        cleanupTempFiles(uploadedFiles);
        return res.status(accessCheck.status!).json({ error: accessCheck.error });
      }

      const sharedIndexData = accessCheck.indexData!;

      // Check if the shared index has can-match permission
      if (!accessCheck.memberPermissions?.includes('can-match')) {
        cleanupTempFiles(uploadedFiles);
        return res.status(403).json({ error: 'Shared index does not allow matching' });
      }

      // Get intents from the shared index
      const sharedIndexIntents = await db.select({
        intentId: intentIndexes.intentId,
        intent: {
          id: intents.id,
          payload: intents.payload,
          userId: intents.userId
        },
        user: {
          id: users.id,
          name: users.name,
          intro: users.intro
        }
      })
      .from(intentIndexes)
      .innerJoin(intents, eq(intentIndexes.intentId, intents.id))
      .innerJoin(users, eq(intents.userId, users.id))
      .where(eq(intentIndexes.indexId, sharedIndexData.id));

      if (sharedIndexIntents.length === 0) {
        cleanupTempFiles(uploadedFiles);
        return res.status(404).json({ error: 'No intents found in shared index' });
      }

      // Process uploaded files to extract text content
      const fileText = await processUploadedFiles(uploadedFiles);
      
      // Don't clean up files immediately - keep them for later attachment
      // cleanupTempFiles(uploadedFiles);

      if (!fileText.trim()) {
        cleanupTempFiles(uploadedFiles);
        return res.status(400).json({ error: 'No readable content found in uploaded files' });
      }

      // Use the first user's intents (in a real scenario, you might want to pick based on some criteria)
      const targetUser = sharedIndexIntents[0].user;
      
      // Get all intents for this user
      const userIntents = sharedIndexIntents
        .filter(item => item.user.id === targetUser.id)
        .map(item => ({ payload: item.intent.payload }));

      // Prepare other user data for vibe check
      const otherUserData = {
        user: {
          id: targetUser.id,
          name: targetUser.name,
          intro: targetUser.intro || ''
        },
        intents: userIntents
      };

      // Call the vibe check agent
      const vibeResult = await vibeCheck(fileText, otherUserData, { timeout: 30000 });

      if (!vibeResult.success) {
        return res.status(500).json({ error: vibeResult.error || 'Vibe check failed' });
      }

      return res.json({
        success: true,
        synthesis: vibeResult.synthesis,
        score: vibeResult.score,
        targetUser: otherUserData.user,
        tempFiles: uploadedFiles.map(f => ({
          id: path.basename(f.path),
          name: f.originalname,
          size: f.size,
          type: f.mimetype
        }))
      });

    } catch (error) {
      // Ensure cleanup happens even if there's an error
      cleanupTempFiles(uploadedFiles || []);
      console.error('Unauthenticated vibe check error:', error);
      return res.status(500).json({ error: 'Failed to perform vibe check' });
    }
  }
);

// Get temp file by ID (authenticated endpoint)
router.get('/temp/:fileId', async (req: Request, res: Response) => {
  try {
    const { fileId } = req.params;
    const tempFilePath = path.join(tempUploadDir, fileId);
    
    if (!fs.existsSync(tempFilePath)) {
      return res.status(404).json({ error: 'Temp file not found' });
    }
    
    // Set proper content type based on file extension
    const ext = path.extname(tempFilePath).toLowerCase();
    const mimeTypes: { [key: string]: string } = {
      '.pdf': 'application/pdf',
      '.doc': 'application/msword',
      '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      '.txt': 'text/plain',
      '.csv': 'text/csv',
      '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      '.xls': 'application/vnd.ms-excel',
      '.json': 'application/json',
      '.md': 'text/markdown',
      '.ppt': 'application/vnd.ms-powerpoint',
      '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      '.rtf': 'application/rtf'
    };
    
    if (mimeTypes[ext]) {
      res.setHeader('Content-Type', mimeTypes[ext]);
    }
    
    // Send file as response
    return res.sendFile(tempFilePath);
  } catch (error) {
    console.error('Error retrieving temp file:', error);
    return res.status(500).json({ error: 'Failed to retrieve temp file' });
  }
});

export default router; 