import { Router, Response } from 'express';
import { eq } from 'drizzle-orm';
import { body, validationResult } from 'express-validator';
import db from '../lib/db';
import { intents } from '../lib/schema';
import { authenticatePrivy, AuthRequest } from '../middleware/auth';
import { discoverUsers } from '../lib/discover';

const router = Router();

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
        excludeDiscovered = true, // Default to true
        page = 1,
        limit = 50
      } = req.body;

      const authenticatedUserId = req.user!.id;


    // Get authenticated user's intents for filtering
    const authenticatedUserIntents = await db
      .select({ intentId: intents.id })
      .from(intents)
      .where(eq(intents.userId, authenticatedUserId));

    // Extract the intent IDs for easier use in the main query
    const userIntentIds = authenticatedUserIntents.map(row => row.intentId);

    // Use the library function to discover users
    const { results: formattedResults, pagination } = await discoverUsers({
      authenticatedUserId,
      userIntentIds,
      intentIds,
      userIds,
      indexIds,
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
        excludeDiscovered: excludeDiscovered
      }
    });
  } catch (err) {
    console.error("Discover filter error:", err);
    return res.status(500).json({ error: "Failed to fetch discovery data" });
  }
});

export default router;
