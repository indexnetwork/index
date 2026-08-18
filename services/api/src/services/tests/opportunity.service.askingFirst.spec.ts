/** Config */
import { config } from "dotenv";
config({ path: ".env.test", override: true });

import { describe, expect, it } from "bun:test";

import type { Opportunity, OpportunityCache, OpportunityControllerDatabase } from "@indexnetwork/protocol";
import { OpportunityService } from "../opportunity.service";
import type { AskingFirstTaskReader } from "../../lib/opportunity/asking-first.projection";

// ─────────────────────────────────────────────────────────────────────────────
// The radar view has to tell four things apart on the same fetch: a match the
// agent PASSED before any contact (rejected, no live task), a match the agents
// are genuinely negotiating, a match already AWAITING the viewer's accept, and
// a match whose negotiation is parked pre-contact because the agent wants to
// ask the viewer first (#1445).
//
// The last one is the ambiguous case: its opportunity is `negotiating` like an
// in-flight dialogue — the status flips when the negotiation task is created,
// one step ahead of the opening turn — so only the park distinguishes it. The
// state must land on exactly that card and no other.
// ─────────────────────────────────────────────────────────────────────────────

const VIEWER = 'user-viewer';
const PARKED_AT = new Date('2026-08-18T09:30:00.000Z');

function opportunity(
  id: string,
  counterpartyId: string,
  status: Opportunity['status'],
): Opportunity {
  const now = new Date('2026-08-18T09:00:00.000Z');
  return {
    id,
    detection: { source: 'opportunity_graph', timestamp: now.toISOString() },
    actors: [
      { userId: VIEWER as never, intent: `intent-${id}` as never, networkId: 'net-1' as never, role: 'peer' },
      { userId: counterpartyId as never, intent: `intent-${counterpartyId}` as never, networkId: 'net-1' as never, role: 'peer' },
    ],
    interpretation: { category: 'connection', reasoning: 'Plausible match.', confidence: 0.9 },
    context: { networkId: 'net-1' as never },
    confidence: '0.9',
    status,
    createdAt: now,
    updatedAt: now,
    expiresAt: null,
    metadata: {},
  } as unknown as Opportunity;
}

/** The one parked task: a pre-contact consult on `opp-asking`. */
function preContactParkedTask() {
  return {
    id: 'task-parked',
    state: 'input_required',
    metadata: {
      type: 'negotiation',
      opportunityId: 'opp-asking',
      turnContext: {
        preContactConsult: true,
        consultationPolicyReason: 'unresolved_owner_constraint',
        seedAssessment: { reasoning: 'Adjacent depth, unclear whether in scope.', valencyRole: 'peer' },
        askUserBinding: {
          version: 2,
          settlementId: 'settlement-1',
          recipientUserId: VIEWER,
          recipientIntentId: 'intent-opp-asking',
          opportunityId: 'opp-asking',
          networkId: 'net-1',
          intentFingerprint: 'fingerprint',
          opportunityStatus: 'negotiating',
          opportunityUpdatedAt: PARKED_AT.toISOString(),
          counterpartyUserId: 'user-asked-about',
          counterpartyIntentId: 'intent-user-asked-about',
        },
      },
    } as Record<string, unknown>,
    updatedAt: PARKED_AT,
  };
}

function createCache(): OpportunityCache {
  const store = new Map<string, unknown>();
  return {
    get: async <T>(key: string) => (store.get(key) as T) ?? null,
    set: async <T>(key: string, value: T) => { store.set(key, value); },
    mget: async <T>(keys: string[]) => keys.map((key) => (store.get(key) as T) ?? null),
  } as OpportunityCache;
}

function createService(tasks: Array<ReturnType<typeof preContactParkedTask>>) {
  const db = {
    // Radar read path.
    getOpportunitiesForUser: () => Promise.resolve([
      opportunity('opp-asking', 'user-asked-about', 'negotiating'),
      opportunity('opp-negotiating', 'user-talking', 'negotiating'),
      opportunity('opp-pending', 'user-agreed', 'pending'),
      opportunity('opp-passed', 'user-passed-on', 'rejected'),
    ]),
    getOpportunity: () => Promise.resolve(null),
    getProfile: () => Promise.resolve(null),
    getActiveIntents: () => Promise.resolve([]),
    getNetwork: () => Promise.resolve({ id: 'net-1', title: 'Test network' }),
    getUser: (id: string) => Promise.resolve({ id, name: `User ${id}`, email: '', avatar: null, socials: [] }),
    getNegotiationTaskForOpportunity: () => Promise.resolve(null),
    getMessagesForConversation: () => Promise.resolve([]),
    getNegotiationMessages: () => Promise.resolve([]),
    getArtifactsForTask: () => Promise.resolve([]),
  } as unknown as OpportunityControllerDatabase;

  const reader: AskingFirstTaskReader = {
    getTasksForUser: (userId: string, options?: { state?: string }) => Promise.resolve(
      userId === VIEWER && options?.state === 'input_required' ? tasks : [],
    ),
  };
  return new OpportunityService(db, createCache(), undefined, {}, reader);
}

/** Skeleton presentation: identity-only cards, so no presenter LLM is involved. */
async function radarItems(tasks: Array<ReturnType<typeof preContactParkedTask>>) {
  const service = createService(tasks);
  const result = await service.getRadarView(VIEWER, {
    presentation: 'skeleton',
    statuses: ['negotiating', 'pending', 'rejected'],
  });
  if ('error' in result) throw new Error(result.error);
  return new Map(
    (result.items as Array<{ opportunityId: string; status?: string; askingFirst?: unknown }>)
      .map((item) => [item.opportunityId, item]),
  );
}

describe('radar view: the "asking you first" state (#1445 follow-up)', () => {
  it('marks the pre-contact-parked opportunity and nothing else on the same radar', async () => {
    const items = await radarItems([preContactParkedTask()]);

    expect(items.get('opp-asking')?.askingFirst).toEqual({
      intentId: 'intent-opp-asking',
      reason: 'unresolved_owner_constraint',
      whatFit: 'Adjacent depth, unclear whether in scope.',
      askedAt: PARKED_AT.toISOString(),
    });

    // Distinct from an in-flight negotiation, from a match already awaiting the
    // viewer, and from one passed before any contact — all four cards ship in
    // the same response, and only the parked one carries the state.
    expect(items.get('opp-asking')?.status).toBe('negotiating');
    expect(items.get('opp-negotiating')?.askingFirst).toBeUndefined();
    expect(items.get('opp-pending')?.askingFirst).toBeUndefined();
    expect(items.get('opp-passed')?.askingFirst).toBeUndefined();
  });

  it('leaves the radar untouched when nothing is parked', async () => {
    const items = await radarItems([]);

    expect(items.size).toBe(4);
    for (const item of items.values()) {
      expect(item.askingFirst).toBeUndefined();
    }
  });

  it('renders the radar anyway when the task read fails', async () => {
    // Fails open: the state is a radar improvement, and the question still
    // reaches the client through the signal's DM and its notification.
    const service = createService([]);
    (service as unknown as { askingFirstTasks: AskingFirstTaskReader }).askingFirstTasks = {
      getTasksForUser: () => Promise.reject(new Error('task query blipped')),
    };

    const result = await service.getRadarView(VIEWER, {
      presentation: 'skeleton',
      statuses: ['negotiating', 'pending', 'rejected'],
    });
    if ('error' in result) throw new Error(result.error);
    expect(result.items).toHaveLength(4);
  });
});
