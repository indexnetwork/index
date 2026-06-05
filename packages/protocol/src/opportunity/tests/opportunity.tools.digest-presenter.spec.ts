// Stub API key to prevent module-level createModel() from throwing — only set when absent
process.env.OPENROUTER_API_KEY ||= 'test-key-unused';

import { mock, describe, expect, it, afterAll } from 'bun:test';

import type { OpportunityPresenter } from '../opportunity.presenter.js';
import type { PresenterDatabase } from '../opportunity.presenter.js';

// ─── Module-level mocks: must run before any static import of opportunity.tools ───

let presentHomeCardMock: ReturnType<typeof mock>;
let gatherPresenterContextMock: ReturnType<typeof mock>;

mock.module('../opportunity.presenter.js', () => {
  presentHomeCardMock = mock(async () => ({
    headline: 'Test Headline',
    personalizedSummary: 'Test personalized summary.',
    suggestedAction: 'Test action',
    narratorRemark: 'Test narrator remark',
    mutualIntentsLabel: undefined,
  }));
  gatherPresenterContextMock = mock(async (
    presenterDb: PresenterDatabase,
    opp: { status: string },
    viewerId: string,
  ) => ({
    opportunityStatus: opp.status,
  }));

  return {
    OpportunityPresenter: class {
      presentHomeCard(input: unknown) {
        return presentHomeCardMock(input);
      }
    },
    gatherPresenterContext: (...args: unknown[]) => gatherPresenterContextMock(...args),
    PresenterDatabase: undefined as unknown as PresenterDatabase, // type-only, not consumed at runtime
  };
});

afterAll(() => mock.restore());

// ─── Imports after mocks ──────────────────────────────────────────────────────

const { buildMinimalOpportunityCard } = await import('../opportunity.tools.js');
const { createOpportunityTools } = await import('../opportunity.tools.js');
const { z } = await import('zod');

import type { ToolDeps, DefineTool } from '../../shared/agent/tool.helpers.js';
import type {
  ChatGraphCompositeDatabase,
  Opportunity,
  UserRecord,
  ProfileRow,
} from '../../shared/interfaces/database.interface.js';

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

let getOppsForUser = mock(async () => [] as Opportunity[]);
let getUser = mock(async () => ({ id: testUserId, name: 'Test User' }) as UserRecord | null);
let getProfile = mock(async () => (null) as ProfileRow | null);

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
    negotiationDatabase: {} as unknown as ToolDeps["negotiationDatabase"],
    graphs: {
      profile: noopGraph,
      intent: noopGraph,
      index: noopGraph,
      networkMembership: noopGraph,
      intentIndex: noopGraph,
      opportunity: noopGraph,
      premise: noopGraph,
    } as unknown as ToolDeps["graphs"],
    ...overrides,
  } as ToolDeps;
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('list_opportunities digest presenter path', () => {
  it('uses LLM presenter text when includeDigestMarkers=true and isMcp=true', async () => {
    getOppsForUser = mock(async () => [makeOpp('opp-1', 'c-1')]);
    getUser = mock(async () => ({ id: testUserId, name: 'Viewer' }) as UserRecord | null);
    getProfile = mock(async () => ({ identity: { name: 'Alice', bio: '', location: '' }, userId: 'c-1' }) as ProfileRow | null);

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
    expect(String(result.data?.message)).toContain('Test personalized summary');
  });

  it('falls back to buildMinimalOpportunityCard when presenter throws', async () => {
    getOppsForUser = mock(async () => [makeOpp('opp-2', 'c-2')]);
    getUser = mock(async () => ({ id: testUserId, name: 'Viewer' }) as UserRecord | null);
    getProfile = mock(async () => ({ identity: { name: 'Bob', bio: '', location: '' }, userId: 'c-2' }) as ProfileRow | null);

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

    // Should succeed and include the counterpart name from the fallback
    expect(result.success).toBe(true);
    expect(String(result.data?.message)).toContain('Bob');
    // Fallback card should NOT contain presenter-specific text
    expect(String(result.data?.message)).not.toContain('Test personalized summary');
  });
});