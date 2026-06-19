// Stub API key to prevent module-level createModel() from throwing — only set when absent
process.env.OPENROUTER_API_KEY ||= 'test-key-unused';

import { mock, describe, expect, it } from 'bun:test';
import { z } from 'zod';

import { createOpportunityTools } from '../opportunity.tools.js';
import type { PresenterDatabase } from '../opportunity.presenter.js';

// ─── Presenter test doubles injected via ToolDeps (no cross-file module mocks) ───

let presentHomeCardMock = mock(async () => ({
  headline: 'Test Headline',
  personalizedSummary: 'Test personalized summary.',
  digestSummary: 'You might like meeting Alice because she matches your current interests.',
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

// Candidate list returned for the digest fetch (draft/pending/latent). The
// digest path now also fetches statuses=['accepted'] for counterpart
// suppression — that call must return [] or candidates suppress themselves.
let candidateOpps: Opportunity[] = [];
const getOppsForUser = mock(async (_userId: string, filter?: { statuses?: string[] }) => {
  if (filter?.statuses?.length === 1 && filter.statuses[0] === 'accepted') return [] as Opportunity[];
  return candidateOpps;
});
let getUser = mock(async () => ({ id: testUserId, name: 'Test User' }) as UserRecord | null);
let getProfile = mock(async () => (null) as UserIdentity | null);

// Negotiation task returned by the negotiation-context loader. Default: no
// negotiation has happened (loadNegotiationContext returns null), so digest
// cards carry no negotiationUrl unless a test opts into one.
type NegotiationTask = {
  id: string;
  conversationId: string;
  state: string;
  metadata: Record<string, unknown> | null;
  createdAt: Date;
  updatedAt: Date;
};
let negotiationTask: NegotiationTask | null = null;
const getNegotiationTaskForOpportunity = mock(async () => negotiationTask);

const noopGraph = { invoke: async () => ({}) };

function makeDeps(overrides: Partial<Parameters<typeof createOpportunityTools>[1]> = {}): ToolDeps {
  const mockDb = {
    getOpportunitiesForUser: getOppsForUser,
    getUser,
    getProfile,
    getActiveIntents: mock(async () => []),
    getNetwork: mock(async () => null),
    getPremisesForUser: mock(async () => []),
  };
  return {
    database: mockDb as unknown as ChatGraphCompositeDatabase,
    userDb: {
      getUser,
      getProfile,
      getUserSocials: mock(async () => []),
      saveProfile: mock(async () => {}),
      updateUser: mock(async () => {}),
      setUserSocials: mock(async () => {}),
      getPremisesForUser: mock(async () => []),
      getActiveIntents: mock(async () => []),
      getNetwork: mock(async () => null),
    } as unknown as ToolDeps["userDb"],
    systemDb: {} as unknown as ToolDeps["systemDb"],
    scraper: {} as unknown as ToolDeps["scraper"],
    embedder: { embedText: mock(async () => []), generateEmbedding: mock(async () => []) } as unknown as ToolDeps["embedder"],
    cache: {} as unknown as ToolDeps["cache"],
    integration: {} as unknown as ToolDeps["integration"],
    contactService: {} as unknown as ToolDeps["contactService"],
    integrationImporter: {} as unknown as ToolDeps["integrationImporter"],
    enricher: {} as unknown as ToolDeps["enricher"],
    frontendUrl: 'https://index.network',
    negotiationDatabase: {
      getNegotiationTaskForOpportunity,
      getMessagesForConversation: mock(async () => []),
      getArtifactsForTask: mock(async () => []),
    } as unknown as ToolDeps["negotiationDatabase"],
    graphs: {
      profile: noopGraph,
      intent: noopGraph,
      index: noopGraph,
      networkMembership: noopGraph,
      intentIndex: noopGraph,
      opportunity: noopGraph,
      premise: noopGraph,
    } as unknown as ToolDeps["graphs"],
    opportunityPresentation: {
      createPresenter: () => ({ presentHomeCard: (input: unknown) => presentHomeCardMock(input) }),
      gatherPresenterContext: (...args: unknown[]) => gatherPresenterContextMock(...args),
    },
    ...overrides,
  } as ToolDeps;
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('list_opportunities digest presenter path', () => {
  it('uses LLM presenter text when includeDigestMarkers=true and isMcp=true', async () => {
    candidateOpps = [makeOpp('opp-1', 'c-1')];
    getUser = mock(async () => ({ id: testUserId, name: 'Viewer' }) as UserRecord | null);
    getProfile = mock(async () => ({ identity: { name: 'Alice', bio: '', location: '' }, userId: 'c-1' }) as unknown as UserIdentity | null);

    const deps = makeDeps();
    const tools = createOpportunityTools(defineTool as unknown as DefineTool, deps);
    const listTool = tools.find((t: { name: string }) => t.name === 'list_opportunities')!;

    const result = parseResult(
      await listTool.handler({
        context: {
          userId: testUserId,
          isMcp: true,
          networkId: undefined,
          sessionId: undefined,
          userName: 'Viewer',
          userNetworks: [],
        },
        query: { includeDigestMarkers: true },
      }),
    );

    expect(result.success).toBe(true);
    expect(gatherPresenterContextMock).toHaveBeenCalled();
    expect(presentHomeCardMock).toHaveBeenCalled();
    expect(String(result.data?.message)).toContain('You might like meeting Alice because she matches your current interests.');
    expect(String(result.data?.message)).not.toContain('Test personalized summary');
  });

  it('emits a negotiationUrl marker and feeds negotiationContext to the presenter when a negotiation exists', async () => {
    candidateOpps = [makeOpp('opp-neg', 'c-neg', 'pending')];
    getUser = mock(async () => ({ id: testUserId, name: 'Viewer' }) as UserRecord | null);
    getProfile = mock(async () => ({ identity: { name: 'Carol', bio: '', location: '' }, userId: 'c-neg' }) as unknown as UserIdentity | null);
    negotiationTask = {
      id: 'task-neg',
      conversationId: 'conv-xyz',
      state: 'completed',
      metadata: { type: 'negotiation', opportunityId: 'opp-neg', maxTurns: 6 },
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    // Capture the presenter input so we can assert negotiationContext threading.
    presentHomeCardMock = mock(async () => ({
      headline: 'Test Headline',
      personalizedSummary: 'Agents agreed you both want to ship privacy tooling.',
      digestSummary: 'You might like meeting Carol because your agents agreed on shared privacy-tooling goals.',
      suggestedAction: 'Test action',
      narratorRemark: 'Test narrator remark',
      mutualIntentsLabel: undefined,
      greeting: '',
    }));

    const deps = makeDeps();
    const tools = createOpportunityTools(defineTool as unknown as DefineTool, deps);
    const listTool = tools.find((t: { name: string }) => t.name === 'list_opportunities')!;

    const result = parseResult(
      await listTool.handler({
        context: {
          userId: testUserId,
          isMcp: true,
          networkId: undefined,
          sessionId: undefined,
          userName: 'Viewer',
          userNetworks: [],
        },
        query: { includeDigestMarkers: true },
      }),
    );

    expect(result.success).toBe(true);
    // EDG-51: digest marker carries the negotiation-trace deep link.
    expect(String(result.data?.message)).toContain('negotiationUrl: https://index.network/chat/conv-xyz?link_preview=false');
    // EDG-50: presenter received the negotiation context so digestSummary can be grounded.
    const lastCall = presentHomeCardMock.mock.calls.at(-1)?.[0] as { negotiationContext?: { conversationId?: string } } | undefined;
    expect(lastCall?.negotiationContext?.conversationId).toBe('conv-xyz');

    negotiationTask = null;
  });

  it('skips digest cards instead of surfacing raw fallback when presenter throws', async () => {
    candidateOpps = [makeOpp('opp-2', 'c-2')];
    getUser = mock(async () => ({ id: testUserId, name: 'Viewer' }) as UserRecord | null);
    getProfile = mock(async () => ({ identity: { name: 'Bob', bio: '', location: '' }, userId: 'c-2' }) as unknown as UserIdentity | null);

    presentHomeCardMock = mock(async () => {
      throw new Error('Presenter failed');
    });

    const deps = makeDeps();
    const tools = createOpportunityTools(defineTool as unknown as DefineTool, deps);
    const listTool = tools.find((t: { name: string }) => t.name === 'list_opportunities')!;

    const result = parseResult(
      await listTool.handler({
        context: {
          userId: testUserId,
          isMcp: true,
          networkId: undefined,
          sessionId: undefined,
          userName: 'Viewer',
          userNetworks: [],
        },
        query: { includeDigestMarkers: true },
      }),
    );

    expect(result.success).toBe(true);
    expect(result.data?.found).toBe(false);
    expect(String(result.data?.message)).toContain("couldn't render");
    expect(String(result.data?.message)).not.toContain('Bob');
    expect(String(result.data?.message)).not.toContain('Reasoning for c-2');
  });
});