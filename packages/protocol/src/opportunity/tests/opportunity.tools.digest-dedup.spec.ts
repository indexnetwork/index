// Stub API key to prevent module-level createModel() from throwing — only set when absent
process.env.OPENROUTER_API_KEY ||= 'test-key-unused';

import { mock, describe, expect, it } from 'bun:test';
import { z } from 'zod';

import { createOpportunityTools } from '../opportunity.tools.js';
import { selectDigestCandidates, DIGEST_REDELIVERY_COOLDOWN_DAYS } from '../opportunity.utils.js';
import type { PresenterDatabase } from '../opportunity.presenter.js';

// ─── Presenter test doubles injected via ToolDeps (no cross-file module mocks) ───

const presentHomeCardMock = mock(async () => ({
  headline: 'Test Headline',
  personalizedSummary: 'Test personalized summary.',
  digestSummary: 'A relevant person for your current signals.',
  suggestedAction: 'Test action',
  narratorRemark: 'Test narrator remark',
  mutualIntentsLabel: undefined,
  greeting: '',
}));
const gatherPresenterContextMock = mock(async (
  _presenterDb: PresenterDatabase,
  opp: { status: string },
  _viewerId: string,
) => ({
  opportunityStatus: opp.status,
}));

import type { ToolDeps, DefineTool } from '../../shared/agent/tool.helpers.js';
import type { ChatGraphCompositeDatabase, Opportunity, UserRecord } from '../../shared/interfaces/database.interface.js';
import type { UserIdentity } from '../../shared/schemas/identity.schema.js';

// ─── Helpers ──────────────────────────────────────────────────────────────────

const testUserId = 'u-test-viewer';
const DAY_MS = 86_400_000;

function makeOpp(
  id: string,
  counterpartUserId: string,
  status: string = 'pending',
  confidence: number = 0.85,
): Opportunity {
  return {
    id,
    status,
    interpretation: { reasoning: `Reasoning for ${counterpartUserId}`, confidence },
    actors: [
      { userId: testUserId, role: 'party' },
      { userId: counterpartUserId, role: 'party' },
    ],
    detection: { source: 'discovery', createdByName: null },
    context: {},
    confidence: confidence,
    createdAt: new Date(),
    updatedAt: new Date(),
    expiresAt: null,
  } as unknown as Opportunity;
}

function defineTool<T extends z.ZodType>(opts: {
  name: string;
  description: string;
  querySchema: T;
  handler: (input: { context: unknown; query: z.infer<T> }) => Promise<string>;
}) {
  return opts;
}

function parseResult(text: string) {
  return JSON.parse(text) as { success: boolean; data?: Record<string, unknown>; error?: string };
}

type OppFilter = { statuses?: string[]; networkId?: string; limit?: number } | undefined;

function makeDeps(opts: {
  /** Returned for the digest candidate fetch (statuses draft/pending/latent). */
  candidates: Opportunity[];
  /** Returned for the accepted-suppression fetch (statuses ['accepted']). */
  accepted?: Opportunity[];
  /** Committed ledger rows returned by the delivery ledger read. */
  deliveredRows?: Array<{ opportunityId: string; deliveredAtStatus: string; deliveredAt: Date }>;
  /** Force the ledger read to throw. */
  ledgerThrows?: boolean;
  /** Force the accepted fetch to throw. */
  acceptedThrows?: boolean;
  /** Omit the optional getDeliveredOpportunities method entirely. */
  ledgerWithoutRead?: boolean;
  profiles?: Record<string, string>;
}): { deps: ToolDeps; calls: { acceptedFetches: OppFilter[]; ledgerReads: Array<{ userId: string; opportunityIds: string[] }> } } {
  const calls = {
    acceptedFetches: [] as OppFilter[],
    ledgerReads: [] as Array<{ userId: string; opportunityIds: string[] }>,
  };

  const getOppsForUser = mock(async (_userId: string, filter: OppFilter) => {
    if (filter?.statuses?.length === 1 && filter.statuses[0] === 'accepted') {
      calls.acceptedFetches.push(filter);
      if (opts.acceptedThrows) throw new Error('accepted fetch boom');
      return opts.accepted ?? [];
    }
    return opts.candidates;
  });
  const getUser = mock(async (id: string) => ({ id, name: `Name ${id}` }) as UserRecord | null);
  const getProfile = mock(async (id: string) => ({
    identity: { name: opts.profiles?.[id] ?? `Profile ${id}`, bio: '', location: '' },
    userId: id,
  }) as unknown as UserIdentity | null);

  const mockDb = {
    getOpportunitiesForUser: getOppsForUser,
    getUser,
    getProfile,
    getActiveIntents: mock(async () => []),
    getNetwork: mock(async () => null),
    getPremisesForUser: mock(async () => []),
  };

  const deliveryLedger = {
    confirmOpportunityDelivery: mock(async () => 'confirmed' as const),
    ...(opts.ledgerWithoutRead
      ? {}
      : {
          getDeliveredOpportunities: mock(async (params: { userId: string; opportunityIds: string[] }) => {
            calls.ledgerReads.push(params);
            if (opts.ledgerThrows) throw new Error('ledger boom');
            return opts.deliveredRows ?? [];
          }),
        }),
  };

  const noopGraph = { invoke: async () => ({}) };
  const deps = {
    database: mockDb as unknown as ChatGraphCompositeDatabase,
    userDb: mockDb as unknown as ToolDeps['userDb'],
    systemDb: {} as unknown as ToolDeps['systemDb'],
    scraper: {} as unknown as ToolDeps['scraper'],
    embedder: { embedText: mock(async () => []), generateEmbedding: mock(async () => []) } as unknown as ToolDeps['embedder'],
    cache: {} as unknown as ToolDeps['cache'],
    integration: {} as unknown as ToolDeps['integration'],
    contactService: {} as unknown as ToolDeps['contactService'],
    integrationImporter: {} as unknown as ToolDeps['integrationImporter'],
    enricher: {} as unknown as ToolDeps['enricher'],
    negotiationDatabase: {} as unknown as ToolDeps['negotiationDatabase'],
    deliveryLedger: deliveryLedger as unknown as ToolDeps['deliveryLedger'],
    opportunityPresentation: {
      createPresenter: () => ({ presentHomeCard: (input: unknown) => presentHomeCardMock(input) }),
      gatherPresenterContext: (...args: unknown[]) => gatherPresenterContextMock(...args),
    },
    graphs: {
      profile: noopGraph,
      intent: noopGraph,
      index: noopGraph,
      networkMembership: noopGraph,
      intentIndex: noopGraph,
      opportunity: noopGraph,
      premise: noopGraph,
    } as unknown as ToolDeps['graphs'],
  } as ToolDeps;

  return { deps, calls };
}

async function runListTool(deps: ToolDeps, query: Record<string, unknown> = { includeDigestMarkers: true }, contextOverrides: Record<string, unknown> = {}) {
  const tools = createOpportunityTools(defineTool as unknown as DefineTool, deps);
  const listTool = tools.find((t: { name: string }) => t.name === 'list_opportunities')!;
  return parseResult(
    await listTool.handler({
      context: {
        userId: testUserId,
        isMcp: true,
        networkId: undefined,
        sessionId: undefined,
        userName: 'Viewer',
        userNetworks: [],
        ...contextOverrides,
      },
      query,
    }),
  );
}

// ─── Pure helper: selectDigestCandidates ─────────────────────────────────────

describe('selectDigestCandidates', () => {
  const now = new Date('2026-06-12T08:00:00Z');
  const candidate = (id: string, counterpart: string, status = 'pending') => ({
    id,
    status,
    actors: [
      { userId: testUserId, role: 'party' },
      { userId: counterpart, role: 'party' },
    ],
  });

  it('passes everything through when nothing is accepted or delivered', () => {
    const cands = [candidate('o1', 'c1'), candidate('o2', 'c2')];
    const { pool, redeliveryIds } = selectDigestCandidates(cands, {
      viewerId: testUserId,
      acceptedCounterpartIds: new Set(),
      deliveredRows: [],
      now,
    });
    expect(pool.map((o) => o.id)).toEqual(['o1', 'o2']);
    expect(redeliveryIds.size).toBe(0);
  });

  it('drops candidates whose counterpart has an accepted opportunity (the Keri case)', () => {
    const cands = [candidate('o-new-keri', 'u-keri'), candidate('o2', 'c2')];
    const { pool } = selectDigestCandidates(cands, {
      viewerId: testUserId,
      acceptedCounterpartIds: new Set(['u-keri']),
      deliveredRows: [],
      now,
    });
    expect(pool.map((o) => o.id)).toEqual(['o2']);
  });

  it('does NOT apply accepted-counterpart suppression when the viewer is the introducer', () => {
    const introOpp = {
      id: 'o-intro',
      status: 'latent',
      actors: [
        { userId: testUserId, role: 'introducer' },
        { userId: 'u-keri', role: 'patient' },
      ],
    };
    const { pool } = selectDigestCandidates([introOpp], {
      viewerId: testUserId,
      acceptedCounterpartIds: new Set(['u-keri']),
      deliveredRows: [],
      now,
    });
    expect(pool.map((o) => o.id)).toEqual(['o-intro']);
  });

  it('drops already-delivered candidates while fresh ones exist', () => {
    const cands = [candidate('o-shown', 'c1'), candidate('o-fresh', 'c2')];
    const { pool, redeliveryIds } = selectDigestCandidates(cands, {
      viewerId: testUserId,
      acceptedCounterpartIds: new Set(),
      deliveredRows: [
        { opportunityId: 'o-shown', deliveredAtStatus: 'pending', deliveredAt: new Date(now.getTime() - DAY_MS) },
      ],
      now,
    });
    expect(pool.map((o) => o.id)).toEqual(['o-fresh']);
    expect(redeliveryIds.size).toBe(0);
  });

  it('dedups on (id, status): a delivery at a previous status does not suppress the new status', () => {
    // Delivered while draft, later promoted to pending — pending is fresh.
    const cands = [candidate('o1', 'c1', 'pending')];
    const { pool } = selectDigestCandidates(cands, {
      viewerId: testUserId,
      acceptedCounterpartIds: new Set(),
      deliveredRows: [
        { opportunityId: 'o1', deliveredAtStatus: 'draft', deliveredAt: new Date(now.getTime() - DAY_MS) },
      ],
      now,
    });
    expect(pool.map((o) => o.id)).toEqual(['o1']);
  });

  it('returns nothing when everything was shown within the cooldown', () => {
    const cands = [candidate('o1', 'c1')];
    const { pool, redeliveryIds } = selectDigestCandidates(cands, {
      viewerId: testUserId,
      acceptedCounterpartIds: new Set(),
      deliveredRows: [
        { opportunityId: 'o1', deliveredAtStatus: 'pending', deliveredAt: new Date(now.getTime() - 2 * DAY_MS) },
      ],
      now,
    });
    expect(pool).toEqual([]);
    expect(redeliveryIds.size).toBe(0);
  });

  it('re-shows the least-recently-shown candidate past the cooldown, flagged as redelivery', () => {
    const cands = [candidate('o-recent', 'c1'), candidate('o-stale', 'c2')];
    const { pool, redeliveryIds } = selectDigestCandidates(cands, {
      viewerId: testUserId,
      acceptedCounterpartIds: new Set(),
      deliveredRows: [
        { opportunityId: 'o-recent', deliveredAtStatus: 'pending', deliveredAt: new Date(now.getTime() - (DIGEST_REDELIVERY_COOLDOWN_DAYS + 1) * DAY_MS) },
        { opportunityId: 'o-stale', deliveredAtStatus: 'pending', deliveredAt: new Date(now.getTime() - (DIGEST_REDELIVERY_COOLDOWN_DAYS + 4) * DAY_MS) },
      ],
      now,
    });
    // Oldest-shown first
    expect(pool.map((o) => o.id)).toEqual(['o-stale', 'o-recent']);
    expect(redeliveryIds).toEqual(new Set(['o-stale', 'o-recent']));
  });

  it('uses the LATEST delivery per key for the cooldown clock', () => {
    const cands = [candidate('o1', 'c1')];
    const { pool } = selectDigestCandidates(cands, {
      viewerId: testUserId,
      acceptedCounterpartIds: new Set(),
      deliveredRows: [
        // Old delivery past cooldown, but a recent one resets the clock.
        { opportunityId: 'o1', deliveredAtStatus: 'pending', deliveredAt: new Date(now.getTime() - 30 * DAY_MS) },
        { opportunityId: 'o1', deliveredAtStatus: 'pending', deliveredAt: new Date(now.getTime() - DAY_MS) },
      ],
      now,
    });
    expect(pool).toEqual([]);
  });

  it('accepted-counterpart suppression also applies to cooldown re-shows', () => {
    const cands = [candidate('o-keri', 'u-keri')];
    const { pool } = selectDigestCandidates(cands, {
      viewerId: testUserId,
      acceptedCounterpartIds: new Set(['u-keri']),
      deliveredRows: [
        { opportunityId: 'o-keri', deliveredAtStatus: 'pending', deliveredAt: new Date(now.getTime() - 30 * DAY_MS) },
      ],
      now,
    });
    expect(pool).toEqual([]);
  });

  it('ignores malformed deliveredAt values', () => {
    const cands = [candidate('o1', 'c1')];
    const { pool } = selectDigestCandidates(cands, {
      viewerId: testUserId,
      acceptedCounterpartIds: new Set(),
      deliveredRows: [
        { opportunityId: 'o1', deliveredAtStatus: 'pending', deliveredAt: new Date('not-a-date') },
      ],
      now,
    });
    // Malformed row is dropped → candidate counts as fresh.
    expect(pool.map((o) => o.id)).toEqual(['o1']);
  });
});

// ─── Tool integration: list_opportunities digest mode ────────────────────────

describe('list_opportunities digest-mode cross-day suppression', () => {
  it('suppresses a candidate whose counterpart appears in an accepted opportunity', async () => {
    const { deps } = makeDeps({
      candidates: [makeOpp('opp-keri-2', 'u-keri'), makeOpp('opp-other', 'u-other')],
      accepted: [makeOpp('opp-keri-1', 'u-keri', 'accepted')],
      profiles: { 'u-keri': 'Keri Shinn', 'u-other': 'Other Person' },
    });

    const result = await runListTool(deps);

    expect(result.success).toBe(true);
    const message = String(result.data?.message);
    expect(message).toContain('opp-other');
    expect(message).not.toContain('opp-keri-2');
    expect(message).not.toContain('Keri Shinn');
  });

  it('suppresses already-delivered opportunities when fresh ones exist', async () => {
    const { deps, calls } = makeDeps({
      candidates: [makeOpp('opp-shown', 'c-shown'), makeOpp('opp-fresh', 'c-fresh')],
      deliveredRows: [
        { opportunityId: 'opp-shown', deliveredAtStatus: 'pending', deliveredAt: new Date(Date.now() - DAY_MS) },
      ],
    });

    const result = await runListTool(deps);

    expect(result.success).toBe(true);
    expect(calls.ledgerReads).toHaveLength(1);
    expect(calls.ledgerReads[0]).toEqual({
      userId: testUserId,
      opportunityIds: ['opp-shown', 'opp-fresh'],
    });
    const message = String(result.data?.message);
    expect(message).toContain('opp-fresh');
    expect(message).not.toContain('opp-shown');
  });

  it('returns the omit-section message when every candidate was shown within cooldown', async () => {
    const { deps } = makeDeps({
      candidates: [makeOpp('opp-shown', 'c-shown')],
      deliveredRows: [
        { opportunityId: 'opp-shown', deliveredAtStatus: 'pending', deliveredAt: new Date(Date.now() - DAY_MS) },
      ],
    });

    const result = await runListTool(deps);

    expect(result.success).toBe(true);
    expect(result.data?.found).toBe(false);
    expect(String(result.data?.message)).toContain('Omit the people section');
    // Must NOT prompt discovery — opportunities exist, they were just shown.
    expect(String(result.data?.message)).not.toContain('discover_opportunities');
  });

  it('re-shows a past-cooldown candidate with a redelivery marker when nothing fresh exists', async () => {
    const staleDate = new Date(Date.now() - (DIGEST_REDELIVERY_COOLDOWN_DAYS + 2) * DAY_MS);
    const { deps } = makeDeps({
      candidates: [makeOpp('opp-stale', 'c-stale')],
      deliveredRows: [
        { opportunityId: 'opp-stale', deliveredAtStatus: 'pending', deliveredAt: staleDate },
      ],
    });

    const result = await runListTool(deps);

    expect(result.success).toBe(true);
    expect(result.data?.found).toBe(true);
    const message = String(result.data?.message);
    expect(message).toContain('digest-opportunity:id=opp-stale');
    expect(message).toContain('redelivery: true');
  });

  it('coerces string deliveredAt values across the serialization boundary', async () => {
    const { deps } = makeDeps({
      candidates: [makeOpp('opp-shown', 'c-shown'), makeOpp('opp-fresh', 'c-fresh')],
      deliveredRows: [
        {
          opportunityId: 'opp-shown',
          deliveredAtStatus: 'pending',
          deliveredAt: new Date(Date.now() - DAY_MS).toISOString() as unknown as Date,
        },
      ],
    });

    const result = await runListTool(deps);
    const message = String(result.data?.message);
    expect(message).toContain('opp-fresh');
    expect(message).not.toContain('opp-shown');
  });

  it('degrades gracefully when the ledger read throws (no suppression, no failure)', async () => {
    const { deps } = makeDeps({
      candidates: [makeOpp('opp-1', 'c-1')],
      ledgerThrows: true,
    });

    const result = await runListTool(deps);

    expect(result.success).toBe(true);
    expect(result.data?.found).toBe(true);
    expect(String(result.data?.message)).toContain('opp-1');
  });

  it('degrades gracefully when the accepted fetch throws', async () => {
    const { deps } = makeDeps({
      candidates: [makeOpp('opp-1', 'c-1')],
      acceptedThrows: true,
    });

    const result = await runListTool(deps);

    expect(result.success).toBe(true);
    expect(result.data?.found).toBe(true);
  });

  it('works when the host ledger predates getDeliveredOpportunities', async () => {
    const { deps } = makeDeps({
      candidates: [makeOpp('opp-1', 'c-1')],
      ledgerWithoutRead: true,
    });

    const result = await runListTool(deps);

    expect(result.success).toBe(true);
    expect(result.data?.found).toBe(true);
    expect(String(result.data?.message)).toContain('opp-1');
  });

  it('applies NO suppression in chat mode (includeDigestMarkers absent)', async () => {
    const { deps, calls } = makeDeps({
      candidates: [makeOpp('opp-keri-2', 'u-keri')],
      accepted: [makeOpp('opp-keri-1', 'u-keri', 'accepted')],
      deliveredRows: [
        { opportunityId: 'opp-keri-2', deliveredAtStatus: 'pending', deliveredAt: new Date(Date.now() - DAY_MS) },
      ],
      profiles: { 'u-keri': 'Keri Shinn' },
    });

    const result = await runListTool(deps, {});

    expect(result.success).toBe(true);
    expect(result.data?.found).toBe(true);
    expect(String(result.data?.message)).toContain('Keri Shinn');
    expect(calls.acceptedFetches).toHaveLength(0);
    expect(calls.ledgerReads).toHaveLength(0);
  });

  it('applies NO suppression for non-MCP callers even with includeDigestMarkers', async () => {
    const { deps, calls } = makeDeps({
      candidates: [makeOpp('opp-1', 'c-1')],
      deliveredRows: [
        { opportunityId: 'opp-1', deliveredAtStatus: 'pending', deliveredAt: new Date(Date.now() - DAY_MS) },
      ],
    });

    const result = await runListTool(deps, { includeDigestMarkers: true }, { isMcp: false });

    expect(result.success).toBe(true);
    expect(calls.acceptedFetches).toHaveLength(0);
    expect(calls.ledgerReads).toHaveLength(0);
  });
});
