import { Router, Response } from 'express';
import { body, param, validationResult } from 'express-validator';
import { authenticatePrivy, AuthRequest } from '../middleware/auth';
import { discoverUsers } from '../lib/discover';
import { getIndexWithPermissions } from '../lib/index-access';

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

    // Use the library function to discover users
    const { results: formattedResults, pagination } = await discoverUsers({
      authenticatedUserId,
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
