import { Router, Response, Request } from 'express';
import { validationResult, body } from 'express-validator';
import path from 'path';
import fs from 'fs';
import db from '../lib/db';
import { intents, users, intentIndexes } from '../lib/schema';
import { eq } from 'drizzle-orm';
import { getIndexWithPermissions } from '../lib/index-access';
import { vibeCheck } from '../agents/external/vibe_checker_text';
import { processUploadedFiles } from '../lib/uploads';
import { analyzeFolder } from '../agents/core/intent_inferrer';
import { getTempPath } from '../lib/paths';
import { createUploadClient } from '../lib/uploads';
import { getMimeTypesForExtension } from '../lib/uploads.config';

const router = Router();

// Use centralized upload client for vibecheck context
const upload = createUploadClient('vibecheck');

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

// Separate function to handle vibe check logic
const performVibeCheck = async (uploadedFiles: Express.Multer.File[], code: string, payloadText?: string) => {
  // Check access to the shared index
  const accessCheck = await getIndexWithPermissions({ code });
  if (!accessCheck.hasAccess) {
    return {
      success: false,
      status: accessCheck.status!,
      error: accessCheck.error
    };
  }

  const sharedIndexData = accessCheck.indexData!;

  // Check if the shared index has can-discover permission
  if (!accessCheck.memberPermissions?.includes('can-discover')) {
    return {
      success: false,
      status: 403,
      error: 'Shared index does not allow matching'
    };
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
    return {
      success: false,
      status: 404,
      error: 'No intents found in shared index'
    };
  }

  // Get text content from either files or payload
  let fileText: string;
  if (payloadText) {
    fileText = payloadText;
  } else {
    // Process uploaded files to extract text content
    const fileResult = await processUploadedFiles(uploadedFiles);
    fileText = fileResult.content;
  }
  
  if (!fileText.trim()) {
    return {
      success: false,
      status: 400,
      error: 'No readable content found'
    };
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

  // Run vibe check
  const vibeResult = await vibeCheck(fileText, otherUserData, { timeout: 30000 });

  if (!vibeResult.success) {
    return {
      success: false,
      status: 500,
      error: vibeResult.error || 'Vibe check failed'
    };
  }

  return {
    success: true,
    synthesis: vibeResult.synthesis,
    score: vibeResult.score,
    targetUser: otherUserData.user
  };
};

// Intent suggestion endpoint - accepts files and/or payload, with optional index code for vibe check
router.post('/intent-suggestion',
  (req: any, res: any, next: any) => {
    upload.array('files', 10)(req, res, next);
  },
  [
    body('payload').optional().isString(),
    body('indexCode').optional().isUUID()
  ],
  async (req: Request, res: Response) => {
    const uploadedFiles = req.files as Express.Multer.File[];
    
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        cleanupTempFiles(uploadedFiles || []);
        return res.status(400).json({ errors: errors.array() });
      }

      const { payload, indexCode } = req.body;

      // Must have either files or payload
      if ((!uploadedFiles || uploadedFiles.length === 0) && !payload) {
        return res.status(400).json({ error: 'Must provide either files or payload' });
      }

      // If only payload, use it directly for intent generation
      if (payload && (!uploadedFiles || uploadedFiles.length === 0)) {
        const response: any = {
          success: true,
          suggestedIntents: [{ payload: payload, confidence: 1.0 }],
          tempFiles: []
        };

        // If index code is provided, also perform vibe check with payload
        if (indexCode) {
          const vibeCheckResult = await performVibeCheck([], indexCode, payload);
          
          if (!vibeCheckResult.success) {
            return res.status(vibeCheckResult.status || 500).json({ error: vibeCheckResult.error });
          }

          // Add vibe check results to response
          response.synthesis = vibeCheckResult.synthesis;
          response.score = vibeCheckResult.score;
          response.targetUser = vibeCheckResult.targetUser;
        }

        return res.json(response);
      }

      // If files (with optional payload), process files and use payload as instruction
      if (uploadedFiles && uploadedFiles.length > 0) {
        const fileIds = uploadedFiles.map(f => path.basename(f.path, path.extname(f.path)));
        
        // Always generate intent suggestions
        const intentInferResult = await analyzeFolder(
          getTempPath('vibecheck'), 
          fileIds, 
          payload, // textInstruction
          [], // existingIntents
          5, // count
          30000 // timeoutMs
        );

        if (!intentInferResult.success) {
          cleanupTempFiles(uploadedFiles);
          return res.status(500).json({ error: 'Intent generation failed' });
        }

        const response: any = {
          success: true,
          suggestedIntents: intentInferResult.intents,
          tempFiles: uploadedFiles.map(f => ({
            id: path.basename(f.path),
            name: f.originalname,
            size: f.size,
            type: f.mimetype
          }))
        };

                 // If index code is provided, also perform vibe check
         if (indexCode) {
           const vibeCheckResult = await performVibeCheck(uploadedFiles, indexCode);
           
           if (!vibeCheckResult.success) {
             cleanupTempFiles(uploadedFiles);
             return res.status(vibeCheckResult.status || 500).json({ error: vibeCheckResult.error });
           }

          // Add vibe check results to response
          response.synthesis = vibeCheckResult.synthesis;
          response.score = vibeCheckResult.score;
          response.targetUser = vibeCheckResult.targetUser;
        }

        return res.json(response);
      }

      // Fallback case - should not reach here normally
      return res.status(400).json({ error: 'Invalid request parameters' });

    } catch (error) {
      cleanupTempFiles(uploadedFiles || []);
      console.error('Intent suggestion error:', error);
      return res.status(500).json({ error: 'Failed to generate intent suggestions' });
    }
  }
);


// Get temp file by ID (authenticated endpoint)
router.get('/temp/:fileId', async (req: Request, res: Response) => {
  try {
    const { fileId } = req.params;
    const tempFilePath = path.join(getTempPath('vibecheck'), fileId);
    
    if (!fs.existsSync(tempFilePath)) {
      return res.status(404).json({ error: 'Temp file not found' });
    }
    
    // Set proper content type based on file extension
    const ext = path.extname(tempFilePath).toLowerCase();
    
    // Set content type using centralized MIME type mapping
    const mimeTypes = getMimeTypesForExtension(ext);
    if (mimeTypes.length > 0) {
      res.setHeader('Content-Type', mimeTypes[0]); // Use the primary MIME type
    }
    
    // Send file as response
    return res.sendFile(tempFilePath);
  } catch (error) {
    console.error('Error retrieving temp file:', error);
    return res.status(500).json({ error: 'Failed to retrieve temp file' });
  }
});

export default router; 