import { Router, Response } from 'express';
import { body, param, validationResult } from 'express-validator';
import { authenticatePrivy, AuthRequest } from '../middleware/auth';
import { discoverUsers } from '../lib/discover';
import { getIndexWithPermissions } from '../lib/index-access';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { v4 as uuidv4 } from 'uuid';
import db from '../lib/db';
import { files, indexLinks } from '../lib/schema';
import { eq } from 'drizzle-orm';
import { getUploadsPath } from '../lib/paths';
import { processUploadedFiles } from '../lib/uploads';
import { crawlLinksForIndex } from '../lib/crawl/web_crawler';
import { analyzeObjects } from '../agents/core/intent_inferrer';
import { IntentService } from '../services/intent-service';
import { createGeneralFileFilter, validateFiles } from '../lib/uploads';
import { FILE_SIZE_LIMITS, MAX_FILES_PER_UPLOAD } from '../lib/uploads.config';

const router = Router();

// Extend the Request interface to include generatedFileId
declare global {
  namespace Express {
    interface Request {
      generatedFileId?: string;
    }
  }
}

// Configure multer for file uploads (permanent storage)
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
    fileSize: FILE_SIZE_LIMITS.GENERAL, // 10MB limit
    files: MAX_FILES_PER_UPLOAD, // Max 10 files
  },
  fileFilter: createGeneralFileFilter(),
});

// Helper function to validate URL
function isValidUrlCandidate(u: string): boolean {
  try {
    const url = new URL(u);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

// Helper function to extract URLs from text
function extractUrlsFromText(text: string): string[] {
  const urlRegex = /https?:\/\/[a-zA-Z0-9.-]+(?::[0-9]+)?(?:\/[^\s]*)?/g;
  const matches = text.match(urlRegex);
  return matches ? matches.filter(isValidUrlCandidate) : [];
}

// 🚀 Route: Process discovery form - upload files, extract URLs, and generate intents
router.post('/new',
  authenticatePrivy,
  upload.array('files', 10),
  [body('payload').optional().isString()],
  async (req: AuthRequest, res: Response) => {
    const uploadedFiles = req.files as Express.Multer.File[];
    
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }

      const { payload } = req.body;
      const userId = req.user!.id;

      console.log(`🚀 Discovery request from user ${userId}`);
      console.log(`📄 Files: ${uploadedFiles?.length || 0}, Payload: ${payload ? 'yes' : 'no'}`);

      // Must have either files or payload
      if ((!uploadedFiles || uploadedFiles.length === 0) && !payload) {
        return res.status(400).json({ error: 'Must provide either files or payload text' });
      }

      // Validate uploaded files
      if (uploadedFiles && uploadedFiles.length > 0) {
        const fileValidation = validateFiles(uploadedFiles, 'general');
        if (!fileValidation.isValid) {
          return res.status(400).json({ error: fileValidation.message });
        }
      }

      const savedFileIds: string[] = [];
      const savedLinkIds: string[] = [];
      let combinedContent = '';
      
      // 1. Save uploaded files to database
      if (uploadedFiles && uploadedFiles.length > 0) {
        for (const file of uploadedFiles) {
          try {
            const fileRecord = await db.insert(files).values({
              id: file.filename.split('.')[0], // Use the UUID from multer
              name: file.originalname,
              size: BigInt(file.size),
              type: file.mimetype,
              userId: userId,
            }).returning({ id: files.id });

            savedFileIds.push(fileRecord[0].id);
            console.log(`✅ File saved: ${fileRecord[0].id} (${file.originalname})`);
          } catch (error) {
            console.error(`❌ Failed to save file ${file.originalname}:`, error);
          }
        }

        // Process files to extract content
        const fileContent = await processUploadedFiles(uploadedFiles);
        if (fileContent.trim()) {
          combinedContent += fileContent + '\n\n';
        }
      }

      // 2. Extract and save URLs from payload
      if (payload) {
        const urls = extractUrlsFromText(payload);
        console.log(`🔗 Found ${urls.length} URLs in payload`);

        for (const url of urls) {
          try {
            // Save link to database
            const linkRecord = await db.insert(indexLinks)
              .values({ userId, url, lastStatus: 'processing' })
              .returning({ id: indexLinks.id });

            savedLinkIds.push(linkRecord[0].id);
            console.log(`✅ Link saved: ${linkRecord[0].id} (${url})`);

            // Crawl URL and save content
            try {
              const crawlResult = await crawlLinksForIndex([url]);
              const crawledFiles = crawlResult.files || [];
              
              if (crawledFiles.length > 0 && crawledFiles[0].content) {
                // Save crawled content to file
                const linksDir = getUploadsPath('links', userId);
                if (!fs.existsSync(linksDir)) fs.mkdirSync(linksDir, { recursive: true });
                const filepath = path.join(linksDir, `${linkRecord[0].id}.md`);
                await fs.promises.writeFile(filepath, crawledFiles[0].content);
                
                combinedContent += `=== ${url} ===\n${crawledFiles[0].content.substring(0, 5000)}\n\n`;
                
                await db.update(indexLinks)
                  .set({ lastSyncAt: new Date(), lastStatus: 'ok', lastError: null })
                  .where(eq(indexLinks.id, linkRecord[0].id));
                  
                console.log(`✅ URL crawled successfully: ${url}`);
              } else {
                await db.update(indexLinks)
                  .set({ lastStatus: 'error: no-content', lastError: 'no-content' })
                  .where(eq(indexLinks.id, linkRecord[0].id));
                console.warn(`⚠️ No content from URL: ${url}`);
              }
            } catch (crawlError) {
              await db.update(indexLinks)
                .set({ lastError: (crawlError as Error).message, lastStatus: 'error' })
                .where(eq(indexLinks.id, linkRecord[0].id));
              console.error(`❌ Failed to crawl URL ${url}:`, crawlError);
            }
          } catch (error) {
            console.error(`❌ Failed to save link ${url}:`, error);
          }
        }
      }

      // 3. Add instruction text to combined content
      if (payload) {
        const instructionText = payload.replace(/https?:\/\/[^\s]+/g, '').trim();
        if (instructionText) {
          combinedContent = `User instruction: ${instructionText}\n\n${combinedContent}`;
        }
      }

      // 4. Generate intents from combined content
      let generatedIntentIds: string[] = [];
      
      if (combinedContent.trim()) {
        console.log(`🤖 Generating intents from ${combinedContent.length} characters`);
        
        // Create objects for intent generation
        const contentObjects = [];
        if (combinedContent) {
          contentObjects.push({ content: combinedContent, name: 'discovery-content' });
        }

        const intentResult = await analyzeObjects(
          contentObjects,
          payload || undefined,
          [], // no existing intents
          5,  // generate 5 intents
          60000 // 60 second timeout
        );

        if (intentResult.success && intentResult.intents.length > 0) {
          console.log(`✅ Generated ${intentResult.intents.length} intents`);
          
          // Save each generated intent to database using IntentService
          for (const generatedIntent of intentResult.intents) {
            // Determine source: use first file if exists, otherwise first link
            const sourceId = savedFileIds[0] || savedLinkIds[0] || undefined;
            const sourceType = savedFileIds[0] ? 'file' as const : (savedLinkIds[0] ? 'link' as const : undefined);

            try {
              const createdIntent = await IntentService.createIntent({
                payload: generatedIntent.payload,
                userId: userId,
                sourceId: sourceId,
                sourceType: sourceType,
                isIncognito: false,
              });

              generatedIntentIds.push(createdIntent.id);
              console.log(`✅ Intent saved: ${createdIntent.id}`);
            } catch (error) {
              console.error(`❌ Failed to save intent:`, error);
            }
          }
        } else {
          console.warn(`⚠️ Intent generation failed or produced no results`);
        }
      } else {
        console.warn(`⚠️ No content to generate intents from`);
      }

      return res.json({
        success: true,
        intentIds: generatedIntentIds,
        filesProcessed: savedFileIds.length,
        linksProcessed: savedLinkIds.length,
        intentsGenerated: generatedIntentIds.length,
      });

    } catch (error) {
      console.error('❌ Discovery request error:', error);
      return res.status(500).json({ error: 'Failed to process discovery request' });
    }
  }
);

/*
Request:{
    "userIds": [
        "b8c3e467-4f65-44e9-9ed8-bdf749b46dc4" // seref's intents limited with userIds
    ],
    "indexIds": [
        "5a338a89-4fc4-48d7-999e-2069ef9ee267" // seref's intents in indexIds
    ],
    "intentIds": [
        "0a31709f-4120-46c5-9a30-aa94891aa378" // seref's specific intents
    ],
    "sources": [
        {"type": "file", "id": "123e4567-e89b-12d3-a456-426614174000"},
        {"type": "link", "id": "223e4567-e89b-12d3-a456-426614174001"},
        {"type": "integration", "id": "323e4567-e89b-12d3-a456-426614174002"}
    ],
    "excludeDiscovered": true,  // exclude users with existing connections (default: true)
    "page" : 1,
    "limit": 50
}
Response:{
    "debugUserId": "7c3ca3cf-048f-43e9-bf47-65f03a6333d8",
    "results": [
        {
            "userId": "b8c3e467-4f65-44e9-9ed8-bdf749b46dc4",
            "totalStake": "100",
            "reasonings": [
                "These two intents are related because they are identical, both expressing a desire to collaborate with UX designers and researchers to explore the implications of AI-driven user interfaces on user experience design."
            ],
            "stakeAmounts": [
                "100"
            ],
            "userIntents": [
                "0a31709f-4120-46c5-9a30-aa94891aa378"
            ]
        }
    ],
    "pagination": {
        "page": 1,
        "limit": 50,
        "hasNext": false,
        "hasPrev": false
    },
    "filters": {
        "intentIds": [
            "0a31709f-4120-46c5-9a30-aa94891aa378"
        ],
        "userIds": [
            "b8c3e467-4f65-44e9-9ed8-bdf749b46dc4"
        ],
        "indexIds": [
            "5a338a89-4fc4-48d7-999e-2069ef9ee267"
        ]
    }
}    
*/

// 🚀 Route: Get paired users' staked intents
router.post("/filter", 
  authenticatePrivy,
  [
    body('intentIds').optional().isArray(),
    body('intentIds.*').optional().isUUID(),
    body('userIds').optional().isArray(),
    body('userIds.*').optional().isUUID(),
    body('indexIds').optional().isArray(),
    body('indexIds.*').optional().isUUID(),
    body('sources').optional().isArray(),
    body('sources.*.type').optional().isIn(['file', 'integration', 'link']),
    body('sources.*.id').optional().isUUID(),
    body('excludeDiscovered').optional().isBoolean(),
    body('page').optional().isInt({ min: 1 }).toInt(),
    body('limit').optional().isInt({ min: 1, max: 100 }).toInt(),
  ],
  async (req: AuthRequest, res: Response) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }

      // Extract filters from request body
      const {
        intentIds,
        userIds,
        indexIds,
        sources,
        excludeDiscovered = true, // Default to true
        page = 1,
        limit = 50
      } = req.body;

      const authenticatedUserId = req.user!.id;

    // Use the library function to discover users
    const { results: formattedResults, pagination } = await discoverUsers({
      authenticatedUserId,
      intentIds,
      userIds,
      indexIds,
      sources,
      excludeDiscovered,
      page,
      limit
    });

    return res.json({
      results: formattedResults,
      pagination,
      filters: {
        intentIds: intentIds || null,
        userIds: userIds || null,
        indexIds: indexIds || null,
        sources: sources || null,
        excludeDiscovered: excludeDiscovered
      }
    });
  } catch (err) {
    console.error("Discover filter error:", err);
    return res.status(500).json({ error: "Failed to fetch discovery data" });
  }
});

// Get stakes for users within a specific shared index, grouped by user
router.get('/index/share/:code/by-user',
  authenticatePrivy,
  [param('code').isUUID()],
  async (req: AuthRequest, res: Response) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }

      const { code } = req.params;

      // Check access to the shared index
      const accessCheck = await getIndexWithPermissions({ code });
      if (!accessCheck.hasAccess) {
        return res.status(accessCheck.status!).json({ error: accessCheck.error });
      }

      const sharedIndexData = accessCheck.indexData!;

      // Check if the shared index has can-discover permission
      if (!accessCheck.memberPermissions?.includes('can-discover')) {
        return res.status(403).json({ error: 'Shared index does not allow discovery' });
      }


      // Use the new discovery logic
      const { results } = await discoverUsers({
        authenticatedUserId: req.user!.id,
        indexIds: [sharedIndexData.id],
        excludeDiscovered: false, // Include all users, not just undiscovered ones
        page: 1,
        limit: 100
      });

      // Format results to match the expected response structure
      const formattedResults = results.map(r => ({
        user: {
          id: r.user.id,
          name: r.user.name,
          avatar: r.user.avatar,
          intro: r.user.intro
        },
        totalStake: r.totalStake.toString(),
        reasoning: r.intents.flatMap(i => i.reasonings).filter(r => r).join(' ')
      }))
      .sort((a, b) => Number(BigInt(b.totalStake) - BigInt(a.totalStake)));

      return res.json(formattedResults);
    } catch (error) {
      console.error('Get index stakes by user error:', error);
      return res.status(500).json({ error: 'Failed to fetch index stakes by user' });
    }
  }
);

export default router;
