import { Router, Response } from 'express';
import { body, param, validationResult } from 'express-validator';
import { authenticatePrivy, AuthRequest } from '../middleware/auth';
import { discoverUsers } from '../lib/discover';
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
import { IntentService } from '../lib/intent-service';
import { createUploadClient, cleanupUploadedFiles } from '../lib/uploads';

const router = Router();

// Extend the Request interface to include generatedFileId
declare global {
  namespace Express {
    interface Request {
      generatedFileId?: string;
    }
  }
}

// Multer will be created per request in the route handler

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
  const urlRegex = /https?:\/\/[a-zA-Z0-9.-]+(?::[0-9]+)?(?:\/[a-zA-Z0-9._~:/?#[\]@!$&'()*+,;=%-]*)?/g;
  const matches = text.match(urlRegex);
  return matches ? matches.filter(isValidUrlCandidate) : [];
}

// 🚀 Route: Process discovery form - upload files, extract URLs, and generate intents
router.post('/new',
  authenticatePrivy,
  (req: AuthRequest, res: Response, next: any) => {
    try {
      const upload = createUploadClient('discovery', req.user!.id);
      upload.array('files', 10)(req as any, res as any, next);
    } catch (error) {
      next(error);
    }
  },
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

      // Files are already validated by multer fileFilter and limits

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
        const fileResult = await processUploadedFiles(uploadedFiles);
        if (fileResult.content.trim()) {
          combinedContent += fileResult.content + '\n\n';
        }
        // Log any processing errors but don't fail the request
        if (fileResult.errors.length > 0) {
          console.warn('File processing errors:', fileResult.errors);
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
      let generatedIntents: any[] = [];
      
      // If payload is short, no files, and no URLs, create intent directly
      const hasFiles = uploadedFiles && uploadedFiles.length > 0;
      const hasUrls = savedLinkIds.length > 0;
      const isShortPayload = payload && payload.length < 100;
      
      if (isShortPayload && !hasFiles && !hasUrls) {
        console.log(`📝 Creating intent directly (short payload, no attachments/URLs)`);
        try {
          const createdIntent = await IntentService.createIntent({
            payload: payload.trim(),
            userId: userId,
            sourceId: undefined,
            sourceType: 'discovery_form',
            isIncognito: false,
            confidence: 1.0,
            inferenceType: 'explicit',
          });

          generatedIntents.push(createdIntent);
          console.log(`✅ Intent created directly: ${createdIntent.id}`);
        } catch (error) {
          console.error(`❌ Failed to create intent directly:`, error);
        }
      } else if (combinedContent.trim()) {
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
          1,  // generate 1 intent
          60000 // 60 second timeout
        );
        
        if (intentResult.success && intentResult.intents.length > 0) {
          console.log(`✅ Generated ${intentResult.intents.length} intents`);
          
          // Save each generated intent to database using IntentService
          for (const generatedIntent of intentResult.intents) {
            // Determine source: use first file if exists, otherwise first link
            const sourceId = savedFileIds[0] || savedLinkIds[0] || undefined;

            try {
              const createdIntent = await IntentService.createIntent({
                payload: generatedIntent.payload,
                userId: userId,
                sourceId: sourceId,
                sourceType: 'discovery_form',
                isIncognito: false,
                confidence: generatedIntent.confidence,
                inferenceType: generatedIntent.type
              });

              generatedIntents.push(createdIntent);
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
        intents: generatedIntents,
        filesProcessed: savedFileIds.length,
        linksProcessed: savedLinkIds.length,
        intentsGenerated: generatedIntents.length,
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



export default router;
