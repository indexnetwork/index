import { Router, Response } from 'express';
import multer from 'multer';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import { authenticatePrivy, AuthRequest } from '../middleware/auth';
import fs from 'fs';
import { getUploadsPath } from '../lib/paths';
import { createUploadClient, validateFileUploads } from '../lib/uploads';

const router = Router();

// Multer will be created per request in the route handler

// Upload avatar endpoint
router.post('/avatar',
  authenticatePrivy,
  (req: AuthRequest, res: Response, next: any) => {
    try {
      const upload = createUploadClient('avatar', req.user!.id);
      upload.single('avatar')(req, res, next);
    } catch (error) {
      next(error);
    }
  },
  async (req: AuthRequest, res: Response) => {
    try {
      if (!req.file) {
        return res.status(400).json({ error: 'No file uploaded' });
      }

      // Additional validation (multer fileFilter handles basic validation)
      const fileValidation = validateFileUploads([req.file], 'avatar');
      if (!fileValidation.isValid) {
        // Clean up uploaded file before returning error
        try {
          await fs.promises.unlink(req.file.path);
        } catch (unlinkError) {
          console.warn(`Failed to remove invalid upload ${req.file.path}:`, unlinkError);
        }
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