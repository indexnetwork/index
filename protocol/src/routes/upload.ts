import { Router, Response } from 'express';
import multer from 'multer';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import { authenticatePrivy, AuthRequest } from '../middleware/auth';
import fs from 'fs';
import { getUploadsPath } from '../lib/paths';
import { createAvatarFileFilter, validateFiles } from '../lib/uploads';
import { FILE_SIZE_LIMITS } from '../lib/uploads.config';

const router = Router();

// Configure multer for avatar uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadDir = getUploadsPath('avatars');
    // Ensure directory exists
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    const filename = `${uuidv4()}${ext}`;
    cb(null, filename);
  }
});

const upload = multer({
  storage,
  limits: {
    fileSize: FILE_SIZE_LIMITS.AVATAR, // 4MB limit
  },
  fileFilter: createAvatarFileFilter(),
});

// Upload avatar endpoint
router.post('/avatar',
  authenticatePrivy,
  upload.single('avatar'),
  async (req: AuthRequest, res: Response) => {
    try {
      if (!req.file) {
        return res.status(400).json({ error: 'No file uploaded' });
      }

      // Additional validation (multer fileFilter handles basic validation)
      const fileValidation = validateFiles([req.file], 'avatar');
      if (!fileValidation.isValid) {
        return res.status(400).json({ error: fileValidation.message });
      }

      // Return just the filename - frontend will construct the full URL
      return res.json({ 
        message: 'Avatar uploaded successfully',
        avatarFilename: req.file.filename
      });
    } catch (error) {
      console.error('Avatar upload error:', error);
      return res.status(500).json({ error: 'Failed to upload avatar' });
    }
  }
);

export default router; 