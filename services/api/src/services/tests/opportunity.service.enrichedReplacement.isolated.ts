/** Config */
import { config } from "dotenv";
config({ path: ".env.test", override: true });

import { describe, expect, it, mock } from "bun:test";

import type { Opportunity, OpportunityControllerDatabase } from '@indexnetwork/protocol';

process.env.OPENROUTER_API_KEY ??= 'test-openrouter-key';

const { OpportunityService } = await import('../opportunity.service');

const VIEWER_ID = 'viewer-001';
const PEER_ID = 'peer-002';
const NETWORK_ID = 'idx-001';
const OLD_OPPORTUNITY_ID = 'opp-old-001';
const NEW_OPPORTUNITY_ID = 'opp-new-002';
const HIDDEN_OPPORTUNITY_ID = 'opp-hidden-003';

function makeOpportunity(id: string, status: Opportunity['status']): Opportunity {
  return {
    id,
    detection: { source: 'opportunity_graph', timestamp: new Date().toISOString() },
    actors: [
      { networkId: NETWORK_ID, userId: VIEWER_ID, role: 'patient' },
      { networkId: NETWORK_ID, userId: PEER_ID, role: 'agent' },
    ],
    interpretation: {
      category: 'collaboration',
      reasoning: 'Both users are exploring agentic discovery workflows.',
      confidence: 0.91,
      signals: [],
    },
    context: { networkId: NETWORK_ID },
    confidence: '0.91',
    status,
    createdAt: new Date('2026-06-01T10:00:00.000Z'),
    updatedAt: new Date('2026-06-01T10:00:00.000Z'),
    expiresAt: null,
  };
}

function createDb(
  opportunities: Record<string, Opportunity>,
  replacementsById: Record<string, Opportunity[]> = {},
) {
  return {
    getOpportunity: mock((id: string) => Promise.resolve(opportunities[id] ?? null)),
    findEnrichedReplacementOpportunities: mock((id: string) => {
      if (id in replacementsById) return Promise.resolve(replacementsById[id]);
      if (id === OLD_OPPORTUNITY_ID && opportunities[NEW_OPPORTUNITY_ID]) {
        return Promise.resolve([opportunities[NEW_OPPORTUNITY_ID]]);
      }
      return Promise.resolve([]);
    }),
    getUser: mock((id: string) => Promise.resolve({
      id,
      name: id === PEER_ID ? 'Peer User' : 'Viewer User',
      avatar: null,
      deletedAt: null,
    })),
    getNetwork: mock((id: string) => Promise.resolve({ id, title: 'Test Index' })),
  } as unknown as OpportunityControllerDatabase;
}

describe('OpportunityService.getOpportunityWithPresentation enriched replacement resolution', () => {
  it('returns the enriched replacement when the requested opportunity was superseded', async () => {
    const oldOpportunity = makeOpportunity(OLD_OPPORTUNITY_ID, 'expired');
    const newOpportunity = {
      ...makeOpportunity(NEW_OPPORTUNITY_ID, 'pending'),
      detection: { source: 'enrichment', enrichedFrom: [OLD_OPPORTUNITY_ID], timestamp: new Date().toISOString() },
    } satisfies Opportunity;
    const db = createDb({ [OLD_OPPORTUNITY_ID]: oldOpportunity, [NEW_OPPORTUNITY_ID]: newOpportunity });
    const service = new OpportunityService(db);

    const result = await service.getOpportunityWithPresentation(OLD_OPPORTUNITY_ID, VIEWER_ID);

    expect(result).not.toBeNull();
    expect(result).not.toHaveProperty('error');
    expect((result as { id: string }).id).toBe(NEW_OPPORTUNITY_ID);
    expect((result as { resolvedFromOpportunityId?: string }).resolvedFromOpportunityId).toBe(OLD_OPPORTUNITY_ID);
    expect(db.findEnrichedReplacementOpportunities).toHaveBeenCalledWith(OLD_OPPORTUNITY_ID);
  });

  it('skips invisible replacements and returns the newest visible replacement', async () => {
    const oldOpportunity = makeOpportunity(OLD_OPPORTUNITY_ID, 'expired');
    const visibleReplacement = {
      ...makeOpportunity(NEW_OPPORTUNITY_ID, 'pending'),
      createdAt: new Date('2026-06-01T10:01:00.000Z'),
      detection: { source: 'enrichment', enrichedFrom: [OLD_OPPORTUNITY_ID], timestamp: new Date().toISOString() },
    } satisfies Opportunity;
    const hiddenReplacement = {
      ...makeOpportunity(HIDDEN_OPPORTUNITY_ID, 'pending'),
      actors: [
        { networkId: NETWORK_ID, userId: 'other-viewer-001', role: 'patient' },
        { networkId: NETWORK_ID, userId: PEER_ID, role: 'agent' },
      ],
      createdAt: new Date('2026-06-01T10:02:00.000Z'),
      detection: { source: 'enrichment', enrichedFrom: [OLD_OPPORTUNITY_ID], timestamp: new Date().toISOString() },
    } satisfies Opportunity;
    const db = createDb(
      {
        [OLD_OPPORTUNITY_ID]: oldOpportunity,
        [NEW_OPPORTUNITY_ID]: visibleReplacement,
        [HIDDEN_OPPORTUNITY_ID]: hiddenReplacement,
      },
      { [OLD_OPPORTUNITY_ID]: [hiddenReplacement, visibleReplacement] },
    );
    const service = new OpportunityService(db);

    const result = await service.getOpportunityWithPresentation(OLD_OPPORTUNITY_ID, VIEWER_ID);

    expect(result).not.toBeNull();
    expect(result).not.toHaveProperty('error');
    expect((result as { id: string }).id).toBe(NEW_OPPORTUNITY_ID);
    expect((result as { resolvedFromOpportunityId?: string }).resolvedFromOpportunityId).toBe(OLD_OPPORTUNITY_ID);
  });

  it('keeps returning the original expired opportunity when there is no enriched replacement', async () => {
    const oldOpportunity = makeOpportunity(OLD_OPPORTUNITY_ID, 'expired');
    const db = createDb({ [OLD_OPPORTUNITY_ID]: oldOpportunity });
    const service = new OpportunityService(db);

    const result = await service.getOpportunityWithPresentation(OLD_OPPORTUNITY_ID, VIEWER_ID);

    expect(result).not.toBeNull();
    expect(result).not.toHaveProperty('error');
    expect((result as { id: string }).id).toBe(OLD_OPPORTUNITY_ID);
    expect((result as { resolvedFromOpportunityId?: string }).resolvedFromOpportunityId).toBeUndefined();
  });
});
