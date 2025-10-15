import { Router, Response } from 'express';
import multer from 'multer';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import { authenticatePrivy, AuthRequest } from '../middleware/auth';
import fs from 'fs';
import { getUploadsPath } from '../lib/paths';
import { createUploadClient, cleanupUploadedFiles } from '../lib/uploads';

const router = Router();

// ============================================================================
// FILE UPLOAD ROUTES
// ============================================================================
// This router handles direct file upload operations:
// - Avatar uploads for user profiles
// - Uses multer for file handling and validation
// ============================================================================

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