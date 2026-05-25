/** Config */
import { config } from "dotenv";
config({ path: '.env.test' });

import { describe, it, expect } from "bun:test";
import { createPremiseTools } from "../premise.tools.js";
import type { ResolvedToolContext } from "../../shared/agent/tool.helpers.js";
import type { PremiseGraphDatabase } from "../../shared/interfaces/database.interface.js";

// ─── Minimal context stub ─────────────────────────────────────────────────────

const userId = '00000000-0000-4000-8000-000000000001';

const context: ResolvedToolContext = {
  userId,
  userName: 'Test User',
  userEmail: 'test@example.com',
  user: { id: userId, name: 'Test User', email: 'test@example.com' } as never,
  userProfile: null,
  userNetworks: [],
  indexScope: [],
  isOnboarding: false,
  hasName: true,
};

// ─── Mock deps factory ────────────────────────────────────────────────────────

const premiseId = '00000000-0000-4000-8000-000000000099';

function makeDeps(overrides?: {
  premiseGraph?: { invoke: (...args: unknown[]) => Promise<unknown> } | undefined;
  getPremise?: (id: string) => Promise<unknown>;
  getPremisesForUser?: (userId: string, status?: string) => Promise<unknown[]>;
  updatePremise?: (id: string, data: unknown) => Promise<unknown>;
}) {
  // Use `in` to distinguish "not provided" from "explicitly undefined"
  const hasPremiseGraph = overrides != null && 'premiseGraph' in overrides;
  const premiseGraph = hasPremiseGraph
    ? overrides!.premiseGraph
    : { invoke: async () => ({ premise: null, error: 'not mocked' }) };

  return {
    database: {
      getPremise: overrides?.getPremise ?? (async () => null),
      getPremisesForUser: overrides?.getPremisesForUser ?? (async () => []),
      updatePremise: overrides?.updatePremise ?? (async () => {}),
    } as unknown as PremiseGraphDatabase,
    graphs: {
      premise: premiseGraph,
    },
  } as never;
}

// ─── Helper to build a defineTool shim ────────────────────────────────────────

function makeDefineTool() {
  type ToolSpec = {
    name: string;
    handler: (input: { context: ResolvedToolContext; query: unknown }) => Promise<string>;
  };

  const tools = new Map<string, ToolSpec>();

  const defineTool = (spec: ToolSpec) => {
    tools.set(spec.name, spec);
    return spec;
  };

  async function call(name: string, query: unknown): Promise<unknown> {
    const tool = tools.get(name);
    if (!tool) throw new Error(`Tool ${name} not found`);
    const raw = await tool.handler({ context, query });
    return JSON.parse(raw);
  }

  return { defineTool, call };
}

// ─── create_premise ───────────────────────────────────────────────────────────

describe('createPremiseTools - create_premise', () => {
  it('returns success with premise data on successful graph invocation', async () => {
    const { defineTool, call } = makeDefineTool();
    createPremiseTools(defineTool, makeDeps({
      premiseGraph: {
        invoke: async () => ({
          premise: {
            id: premiseId,
            assertion: { text: 'I am a software engineer', tier: 'assertive' },
            analysis: { speechActType: 'ASSERTIVE', felicityClarity: 0.95 },
            status: 'ACTIVE',
          },
          networkAssignments: ['net-1', 'net-2'],
        }),
      },
    }));

    const result = await call('create_premise', {
      text: 'I am a software engineer',
      tier: 'assertive',
    }) as { success: boolean; data: { id: string; assertion: string; tier: string; analysisSummary: string; indexesAssigned: number } };

    expect(result.success).toBe(true);
    expect(result.data.id).toBe(premiseId);
    expect(result.data.assertion).toBe('I am a software engineer');
    expect(result.data.tier).toBe('assertive');
    expect(result.data.indexesAssigned).toBe(2);
    expect(result.data.analysisSummary).toContain('ASSERTIVE');
  });

  it('returns error when graph invoke returns an error', async () => {
    const { defineTool, call } = makeDefineTool();
    createPremiseTools(defineTool, makeDeps({
      premiseGraph: {
        invoke: async () => ({ error: 'graph processing failed' }),
      },
    }));

    const result = await call('create_premise', {
      text: 'I am a researcher',
      tier: 'assertive',
    }) as { success: boolean; error: string };

    expect(result.success).toBe(false);
    expect(result.error).toContain('graph processing failed');
  });

  it('returns error when graph returns no premise and no error', async () => {
    const { defineTool, call } = makeDefineTool();
    createPremiseTools(defineTool, makeDeps({
      premiseGraph: {
        invoke: async () => ({ premise: null }),
      },
    }));

    const result = await call('create_premise', {
      text: 'I am a designer',
      tier: 'assertive',
    }) as { success: boolean; error: string };

    expect(result.success).toBe(false);
    expect(result.error).toContain('Premise creation failed');
  });

  it('returns error when premise graph is not available', async () => {
    const { defineTool, call } = makeDefineTool();
    createPremiseTools(defineTool, makeDeps({ premiseGraph: undefined }));

    const result = await call('create_premise', {
      text: 'I am an engineer',
      tier: 'assertive',
    }) as { success: boolean; error: string };

    expect(result.success).toBe(false);
    expect(result.error).toBe('Premise graph not available.');
  });

  it('reports zero indexesAssigned when networkAssignments is absent', async () => {
    const { defineTool, call } = makeDefineTool();
    createPremiseTools(defineTool, makeDeps({
      premiseGraph: {
        invoke: async () => ({
          premise: {
            id: premiseId,
            assertion: { text: 'I live in Berlin', tier: 'assertive' },
            analysis: null,
            status: 'ACTIVE',
          },
        }),
      },
    }));

    const result = await call('create_premise', {
      text: 'I live in Berlin',
      tier: 'assertive',
    }) as { success: boolean; data: { indexesAssigned: number; analysisSummary: string } };

    expect(result.success).toBe(true);
    expect(result.data.indexesAssigned).toBe(0);
    expect(result.data.analysisSummary).toBe('no analysis');
  });
});

// ─── read_premises ────────────────────────────────────────────────────────────

describe('createPremiseTools - read_premises', () => {
  const activePremise = {
    id: premiseId,
    assertion: { text: 'I am a software engineer', tier: 'assertive' },
    status: 'ACTIVE',
    analysis: { speechActType: 'ASSERTIVE', felicityClarity: 0.9 },
    validity: { validFrom: null, validUntil: null, volatile: false },
  };

  const retractedPremise = {
    id: '00000000-0000-4000-8000-000000000098',
    assertion: { text: 'I worked at Acme Corp', tier: 'assertive' },
    status: 'RETRACTED',
    analysis: null,
    validity: { validFrom: null, validUntil: null, volatile: false },
  };

  it('returns mapped premises with count', async () => {
    const { defineTool, call } = makeDefineTool();
    createPremiseTools(defineTool, makeDeps({
      getPremisesForUser: async () => [activePremise],
    }));

    const result = await call('read_premises', {}) as {
      success: boolean;
      data: { premises: Array<{ id: string; text: string; tier: string; status: string }>; count: number };
    };

    expect(result.success).toBe(true);
    expect(result.data.count).toBe(1);
    expect(result.data.premises[0].id).toBe(premiseId);
    expect(result.data.premises[0].text).toBe('I am a software engineer');
    expect(result.data.premises[0].tier).toBe('assertive');
    expect(result.data.premises[0].status).toBe('ACTIVE');
  });

  it('passes ACTIVE status filter by default (includeRetracted: false)', async () => {
    let capturedStatus: string | undefined;
    const { defineTool, call } = makeDefineTool();
    createPremiseTools(defineTool, makeDeps({
      getPremisesForUser: async (_uid: string, status?: string) => {
        capturedStatus = status;
        return [activePremise];
      },
    }));

    const result = await call('read_premises', { includeRetracted: false }) as {
      success: boolean;
      data: { count: number };
    };

    expect(result.success).toBe(true);
    expect(capturedStatus).toBe('ACTIVE');
    expect(result.data.count).toBe(1);
  });

  it('passes no status filter when includeRetracted is true', async () => {
    let capturedStatus: string | undefined = 'sentinel';
    const { defineTool, call } = makeDefineTool();
    createPremiseTools(defineTool, makeDeps({
      getPremisesForUser: async (_uid: string, status?: string) => {
        capturedStatus = status;
        return [activePremise, retractedPremise];
      },
    }));

    const result = await call('read_premises', { includeRetracted: true }) as {
      success: boolean;
      data: { count: number };
    };

    expect(result.success).toBe(true);
    expect(capturedStatus).toBeUndefined();
    expect(result.data.count).toBe(2);
  });

  it('returns error for invalid userId format', async () => {
    const { defineTool, call } = makeDefineTool();
    createPremiseTools(defineTool, makeDeps());

    const result = await call('read_premises', { userId: 'not-a-uuid' }) as { success: boolean; error: string };

    expect(result.success).toBe(false);
    expect(result.error).toContain('Invalid userId format');
  });
});

// ─── update_premise ───────────────────────────────────────────────────────────

describe('createPremiseTools - update_premise', () => {
  const existingPremise = {
    userId,
    status: 'ACTIVE',
    assertion: { text: 'I am a software engineer', tier: 'assertive' },
    validity: { validFrom: null, validUntil: null, volatile: false },
  };

  it('returns success when premise is found, owned, and active', async () => {
    const { defineTool, call } = makeDefineTool();
    createPremiseTools(defineTool, makeDeps({
      getPremise: async () => existingPremise,
      premiseGraph: {
        invoke: async () => ({
          premise: {
            id: premiseId,
            assertion: { text: 'I am a senior software engineer', tier: 'assertive' },
            status: 'ACTIVE',
          },
        }),
      },
    }));

    const result = await call('update_premise', {
      premiseId,
      text: 'I am a senior software engineer',
    }) as { success: boolean; data: { id: string; assertion: string; status: string } };

    expect(result.success).toBe(true);
    expect(result.data.id).toBe(premiseId);
    expect(result.data.assertion).toBe('I am a senior software engineer');
    expect(result.data.status).toBe('ACTIVE');
  });

  it('returns error for invalid premiseId format', async () => {
    const { defineTool, call } = makeDefineTool();
    createPremiseTools(defineTool, makeDeps());

    const result = await call('update_premise', { premiseId: 'invalid-id', text: 'new text' }) as { success: boolean; error: string };

    expect(result.success).toBe(false);
    expect(result.error).toContain('Invalid premiseId format');
  });

  it('returns error when premise is not found', async () => {
    const { defineTool, call } = makeDefineTool();
    createPremiseTools(defineTool, makeDeps({
      getPremise: async () => null,
    }));

    const result = await call('update_premise', { premiseId, text: 'new text' }) as { success: boolean; error: string };

    expect(result.success).toBe(false);
    expect(result.error).toContain('Premise not found');
  });

  it('returns error when premise is not owned by caller', async () => {
    const { defineTool, call } = makeDefineTool();
    createPremiseTools(defineTool, makeDeps({
      getPremise: async () => ({ ...existingPremise, userId: 'other-user-id' }),
    }));

    const result = await call('update_premise', { premiseId, text: 'new text' }) as { success: boolean; error: string };

    expect(result.success).toBe(false);
    expect(result.error).toContain('only update your own');
  });

  it('returns error when premise is already retracted', async () => {
    const { defineTool, call } = makeDefineTool();
    createPremiseTools(defineTool, makeDeps({
      getPremise: async () => ({ ...existingPremise, status: 'RETRACTED' }),
    }));

    const result = await call('update_premise', { premiseId, text: 'new text' }) as { success: boolean; error: string };

    expect(result.success).toBe(false);
    expect(result.error).toContain('Cannot update a retracted premise');
  });

  it('returns error when graph returns an error during update', async () => {
    const { defineTool, call } = makeDefineTool();
    createPremiseTools(defineTool, makeDeps({
      getPremise: async () => existingPremise,
      premiseGraph: {
        invoke: async () => ({ error: 'update graph failed' }),
      },
    }));

    const result = await call('update_premise', { premiseId, text: 'new text' }) as { success: boolean; error: string };

    expect(result.success).toBe(false);
    expect(result.error).toContain('update graph failed');
  });

  it('returns error when premise graph is not available for text updates', async () => {
    const { defineTool, call } = makeDefineTool();
    createPremiseTools(defineTool, makeDeps({
      getPremise: async () => existingPremise,
      premiseGraph: undefined,
    }));

    const result = await call('update_premise', { premiseId, text: 'new text' }) as { success: boolean; error: string };

    expect(result.success).toBe(false);
    expect(result.error).toBe('Premise graph not available.');
  });

  it('bypasses graph for metadata-only updates (no text change)', async () => {
    let dbUpdateCalled = false;
    const { defineTool, call } = makeDefineTool();
    createPremiseTools(defineTool, makeDeps({
      getPremise: async () => existingPremise,
      updatePremise: async () => {
        dbUpdateCalled = true;
        return {
          id: premiseId,
          assertion: existingPremise.assertion,
          status: 'ACTIVE',
        };
      },
      premiseGraph: {
        invoke: async () => { throw new Error('graph should not be called'); },
      },
    }));

    const result = await call('update_premise', {
      premiseId,
      validUntil: '2026-12-31T23:59:59Z',
    }) as { success: boolean; data: { id: string; message: string } };

    expect(result.success).toBe(true);
    expect(dbUpdateCalled).toBe(true);
    expect(result.data.message).toContain('metadata only');
  });

  it('returns error when no fields are provided for update', async () => {
    const { defineTool, call } = makeDefineTool();
    createPremiseTools(defineTool, makeDeps({
      getPremise: async () => existingPremise,
    }));

    const result = await call('update_premise', { premiseId }) as { success: boolean; error: string };

    expect(result.success).toBe(false);
    expect(result.error).toContain('No fields to update');
  });

  it('metadata-only update succeeds even without a graph', async () => {
    const { defineTool, call } = makeDefineTool();
    createPremiseTools(defineTool, makeDeps({
      getPremise: async () => existingPremise,
      updatePremise: async () => ({
        id: premiseId,
        assertion: existingPremise.assertion,
        status: 'ACTIVE',
      }),
      premiseGraph: undefined,
    }));

    const result = await call('update_premise', {
      premiseId,
      volatile: true,
    }) as { success: boolean; data: { id: string; message: string } };

    expect(result.success).toBe(true);
    expect(result.data.message).toContain('metadata only');
  });
});

// ─── retract_premise ──────────────────────────────────────────────────────────

describe('createPremiseTools - retract_premise', () => {
  const existingPremise = {
    userId,
    status: 'ACTIVE',
    assertion: { text: 'I am a software engineer', tier: 'assertive' },
    validity: { validFrom: null, validUntil: null, volatile: false },
  };

  it('retracts successfully when premise is found, owned, and active', async () => {
    let updatedId: string | undefined;
    let updatedData: unknown;

    const { defineTool, call } = makeDefineTool();
    createPremiseTools(defineTool, makeDeps({
      getPremise: async () => existingPremise,
      updatePremise: async (id, data) => {
        updatedId = id;
        updatedData = data;
      },
    }));

    const result = await call('retract_premise', { premiseId }) as {
      success: boolean;
      data: { id: string; message: string };
    };

    expect(result.success).toBe(true);
    expect(result.data.id).toBe(premiseId);
    expect(result.data.message).toContain('retracted successfully');
    expect(updatedId).toBe(premiseId);
    expect((updatedData as { status: string }).status).toBe('RETRACTED');
    expect((updatedData as { retractedAt: unknown }).retractedAt).toBeInstanceOf(Date);
  });

  it('returns error for invalid premiseId format', async () => {
    const { defineTool, call } = makeDefineTool();
    createPremiseTools(defineTool, makeDeps());

    const result = await call('retract_premise', { premiseId: 'bad-id' }) as { success: boolean; error: string };

    expect(result.success).toBe(false);
    expect(result.error).toContain('Invalid premiseId format');
  });

  it('returns error when premise is not found', async () => {
    const { defineTool, call } = makeDefineTool();
    createPremiseTools(defineTool, makeDeps({
      getPremise: async () => null,
    }));

    const result = await call('retract_premise', { premiseId }) as { success: boolean; error: string };

    expect(result.success).toBe(false);
    expect(result.error).toContain('Premise not found');
  });

  it('returns error when premise is not owned by caller', async () => {
    const { defineTool, call } = makeDefineTool();
    createPremiseTools(defineTool, makeDeps({
      getPremise: async () => ({ ...existingPremise, userId: 'different-user' }),
    }));

    const result = await call('retract_premise', { premiseId }) as { success: boolean; error: string };

    expect(result.success).toBe(false);
    expect(result.error).toContain('only retract your own');
  });

  it('returns error when premise is already retracted', async () => {
    const { defineTool, call } = makeDefineTool();
    createPremiseTools(defineTool, makeDeps({
      getPremise: async () => ({ ...existingPremise, status: 'RETRACTED' }),
    }));

    const result = await call('retract_premise', { premiseId }) as { success: boolean; error: string };

    expect(result.success).toBe(false);
    expect(result.error).toContain('already retracted');
  });
});
