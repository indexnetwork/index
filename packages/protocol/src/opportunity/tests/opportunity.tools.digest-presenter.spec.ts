// Stub API key to prevent module-level createModel() from throwing
process.env.OPENROUTER_API_KEY = 'test-key-unused';

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
    opp: any,
    viewerId: string,
  ) => ({
    opportunityStatus: opp.status,
  }));

  return {
    OpportunityPresenter: class {
      presentHomeCard(input: any) {
        return presentHomeCardMock(input);
      }
    },
    gatherPresenterContext: (...args: any[]) => gatherPresenterContextMock(...args),
    PresenterDatabase: undefined as any, // type-only, not consumed at runtime
  };
});

afterAll(() => mock.restore());

// ─── Imports after mocks ──────────────────────────────────────────────────────

const { buildMinimalOpportunityCard } = await import('../opportunity.tools.js');
const { createOpportunityTools } = await import('../opportunity.tools.js');
const { z } = await import('zod');

import type { ToolDeps } from '../../shared/agent/tool.helpers.js';
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
  handler: (input: { context: any; query: z.infer<T> }) => Promise<string>;
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
    } as any,
    systemDb: {} as any,
    scraper: {} as any,
    embedder: { embedText: mock(async () => []), generateEmbedding: mock(async () => []) } as any,
    cache: {} as any,
    integration: {} as any,
    contactService: {} as any,
    integrationImporter: {} as any,
    enricher: {} as any,
    negotiationDatabase: {} as any,
    graphs: {
      profile: noopGraph as any,
      intent: noopGraph as any,
      index: noopGraph as any,
      networkMembership: noopGraph as any,
      intentIndex: noopGraph as any,
      opportunity: noopGraph as any,
      premise: noopGraph as any,
    },
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
    const tools = createOpportunityTools(defineTool as any, deps);
    const listTool = tools.find((t: any) => t.name === 'list_opportunities')!;

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
    const tools = createOpportunityTools(defineTool as any, deps);
    const listTool = tools.find((t: any) => t.name === 'list_opportunities')!;

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