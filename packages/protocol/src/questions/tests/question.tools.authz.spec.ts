import { describe, expect, test } from 'bun:test';
import { z } from 'zod';

import { createQuestionerTools } from '../application/question.tools.js';
import type { QuestionerToolDeps } from '../ports/question.tools.port.js';
import type { ResolvedToolContext } from '../../shared/agent/tool.helpers.js';
import type { PendingQuestionSummary } from '../../shared/schemas/pending-question.schema.js';

/**
 * IND-608 — question-answer provenance and authorization at the tool/handler
 * seam (DB-free). Covers: authenticated-user provenance (the caller's own
 * userId is always threaded to the pipeline), foreign-question rejection (a
 * questionId not among the caller's pending set is refused), replay rejection
 * (an already-answered question records nothing), affected-domain network clamp
 * (network-scoped agents cannot answer and read only self-owned, in-network
 * questions), and that no answer is written on any rejection path.
 */

interface CapturedTool {
  handler: (input: { context: ResolvedToolContext; query: unknown }) => Promise<string>;
  querySchema?: z.ZodType;
}

function captureTools(deps: Partial<QuestionerToolDeps>): Record<string, CapturedTool> {
  const captured: Record<string, CapturedTool> = {};
  const defineTool = (def: { name: string } & CapturedTool) => {
    captured[def.name] = def;
    return def;
  };
  createQuestionerTools(defineTool as never, deps as QuestionerToolDeps);
  return captured;
}

function makeContext(
  userId = 'user-owner',
  scope?: {
    networkId?: string;
    intentId?: string;
    /** MCP caller context; omit for the owner-trusted (REST/chat) path. */
    mcpCaller?: { kind: 'human' | 'agent'; permissions: string[]; networkScopeId?: string | null };
  },
): ResolvedToolContext {
  return {
    userId,
    user: { id: userId, name: 'Owner', email: 'o@test' } as never,
    userProfile: null,
    userNetworks: [],
    isMcp: true,
    ...(scope?.mcpCaller
      ? { mcpCaller: { networkScopeId: null, ...scope.mcpCaller } }
      : {}),
    ...(scope?.intentId
      ? { scopeType: 'intent' as const, scopeId: scope.intentId }
      : scope?.networkId
        ? { scopeType: 'network' as const, scopeId: scope.networkId }
        : {}),
  } as unknown as ResolvedToolContext;
}

const intentsAgent = { kind: 'agent' as const, permissions: ['manage:intents'] };
const negotiationsAgent = { kind: 'agent' as const, permissions: ['manage:negotiations'] };
const identityAgent = { kind: 'agent' as const, permissions: ['manage:identity'] };
const premisesAgent = { kind: 'agent' as const, permissions: ['manage:premises'] };
const opportunitiesAgent = { kind: 'agent' as const, permissions: ['manage:opportunities'] };

function question(overrides: Partial<PendingQuestionSummary> = {}): PendingQuestionSummary {
  return {
    id: 'q1',
    title: 'Title',
    prompt: 'Prompt',
    mode: 'intent',
    options: [],
    multiSelect: false,
    sourceType: 'intent',
    sourceId: 'intent-1',
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    ...overrides,
  } as PendingQuestionSummary;
}

function parse(result: string) {
  return JSON.parse(result) as { success: boolean; error?: string; data?: Record<string, unknown> };
}

describe('answer_pending_question — provenance & authorization (IND-608)', () => {
  test('threads the authenticated caller userId to both lookup and answer (provenance)', async () => {
    const findCalls: string[] = [];
    const answerCalls: Array<{ userId: string; questionId: string }> = [];
    const tools = captureTools({
      findPendingQuestions: async (userId: string) => {
        findCalls.push(userId);
        return [question({ id: 'q1' })];
      },
      answerPendingQuestion: async (userId: string, questionId: string) => {
        answerCalls.push({ userId, questionId });
        return true;
      },
    });

    const result = parse(await tools.answer_pending_question!.handler({
      context: makeContext('user-owner'),
      query: { questionId: 'q1', freeText: 'my explicit answer' },
    }));

    expect(result.success).toBe(true);
    // The pipeline is always scoped to the authenticated caller, never a
    // client-supplied identity.
    expect(findCalls).toEqual(['user-owner']);
    expect(answerCalls).toEqual([{ userId: 'user-owner', questionId: 'q1' }]);
  });

  test('rejects a foreign question id not among the caller pending set, writing nothing', async () => {
    let answered = 0;
    const tools = captureTools({
      findPendingQuestions: async () => [question({ id: 'q-own' })],
      answerPendingQuestion: async () => {
        answered += 1;
        return true;
      },
    });

    const result = parse(await tools.answer_pending_question!.handler({
      context: makeContext('user-owner'),
      query: { questionId: 'q-belongs-to-someone-else', freeText: 'answer' },
    }));

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/not found among the client's pending questions/i);
    expect(answered).toBe(0);
  });

  test('rejects replay of an already-answered question', async () => {
    const tools = captureTools({
      findPendingQuestions: async () => [question({ id: 'q1' })],
      // The pipeline reports "no row updated" for an already-settled question.
      answerPendingQuestion: async () => false,
    });

    const result = parse(await tools.answer_pending_question!.handler({
      context: makeContext('user-owner'),
      query: { questionId: 'q1', freeText: 'answer' },
    }));

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/already answered or dismissed/i);
  });

  test('network-scoped agents cannot answer questions (affected-domain clamp), writing nothing', async () => {
    let findCalled = 0;
    let answered = 0;
    const tools = captureTools({
      findPendingQuestions: async () => {
        findCalled += 1;
        return [question({ id: 'q1' })];
      },
      answerPendingQuestion: async () => {
        answered += 1;
        return true;
      },
    });

    const result = parse(await tools.answer_pending_question!.handler({
      context: makeContext('user-owner', { networkId: 'network-1' }),
      query: { questionId: 'q1', freeText: 'answer' },
    }));

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/not available for network-scoped agents/i);
    expect(findCalled).toBe(0);
    expect(answered).toBe(0);
  });

  test('denies a global manage:intents agent answering a negotiation question, writing nothing', async () => {
    let answered = 0;
    const tools = captureTools({
      findPendingQuestions: async () => [question({ id: 'neg-1', mode: 'negotiation' })],
      answerPendingQuestion: async () => {
        answered += 1;
        return true;
      },
    });

    const result = parse(await tools.answer_pending_question!.handler({
      context: makeContext('user-owner', { mcpCaller: intentsAgent }),
      query: { questionId: 'neg-1', freeText: 'answer' },
    }));

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/not authorized to answer this question/i);
    expect(answered).toBe(0);
  });

  test('admits a manage:negotiations agent answering a negotiation question (matching domain)', async () => {
    const answerCalls: Array<{ userId: string; questionId: string }> = [];
    const tools = captureTools({
      findPendingQuestions: async () => [question({ id: 'neg-1', mode: 'negotiation' })],
      answerPendingQuestion: async (userId: string, questionId: string) => {
        answerCalls.push({ userId, questionId });
        return true;
      },
    });

    const result = parse(await tools.answer_pending_question!.handler({
      context: makeContext('user-owner', { mcpCaller: negotiationsAgent }),
      query: { questionId: 'neg-1', freeText: 'answer' },
    }));

    expect(result.success).toBe(true);
    expect(answerCalls).toEqual([{ userId: 'user-owner', questionId: 'neg-1' }]);
  });

  test('enrichment affects premises: identity-only agent is denied and writes nothing; premises agent is admitted', async () => {
    const attempt = async (mcpCaller: { kind: 'agent'; permissions: string[] }) => {
      let answered = 0;
      const tools = captureTools({
        findPendingQuestions: async () => [question({ id: 'enrich-1', mode: 'enrichment' })],
        answerPendingQuestion: async () => {
          answered += 1;
          return true;
        },
      });
      const result = parse(await tools.answer_pending_question!.handler({
        context: makeContext('user-owner', { mcpCaller }),
        query: { questionId: 'enrich-1', freeText: 'answer' },
      }));
      return { result, answered };
    };

    // Enrichment maps to premises, so an identity-only agent cannot answer it.
    const identity = await attempt(identityAgent);
    expect(identity.result.success).toBe(false);
    expect(identity.result.error).toMatch(/not authorized to answer this question/i);
    expect(identity.answered).toBe(0);

    // A premises agent can.
    const premises = await attempt(premisesAgent);
    expect(premises.result.success).toBe(true);
    expect(premises.answered).toBe(1);
  });

  test('discovery affects opportunities: an intents-only agent is denied, an opportunities agent is admitted', async () => {
    const attempt = async (mcpCaller: { kind: 'agent'; permissions: string[] }) => {
      let answered = 0;
      const tools = captureTools({
        findPendingQuestions: async () => [question({ id: 'disc-1', mode: 'discovery' })],
        answerPendingQuestion: async () => {
          answered += 1;
          return true;
        },
      });
      const result = parse(await tools.answer_pending_question!.handler({
        context: makeContext('user-owner', { mcpCaller }),
        query: { questionId: 'disc-1', freeText: 'answer' },
      }));
      return { result, answered };
    };

    const intents = await attempt(intentsAgent);
    expect(intents.result.success).toBe(false);
    expect(intents.answered).toBe(0);

    const opportunities = await attempt(opportunitiesAgent);
    expect(opportunities.result.success).toBe(true);
    expect(opportunities.answered).toBe(1);
  });

  test('chat and unknown modes are human-only: no agent permission can answer them, no write', async () => {
    const allPermsAgent = {
      kind: 'agent' as const,
      permissions: ['manage:identity', 'manage:premises', 'manage:intents', 'manage:opportunities', 'manage:negotiations'],
    };
    for (const mode of ['chat', 'future_unknown_mode'] as const) {
      let answered = 0;
      const tools = captureTools({
        findPendingQuestions: async () => [question({ id: 'q1', mode: mode as never })],
        answerPendingQuestion: async () => {
          answered += 1;
          return true;
        },
      });
      const result = parse(await tools.answer_pending_question!.handler({
        context: makeContext('user-owner', { mcpCaller: allPermsAgent }),
        query: { questionId: 'q1', freeText: 'answer' },
      }));
      expect(result.success).toBe(false);
      expect(answered).toBe(0);
    }
  });

  test('the owning human (mcpCaller.kind=human) may answer any domain', async () => {
    let answered = 0;
    const tools = captureTools({
      findPendingQuestions: async () => [question({ id: 'neg-1', mode: 'negotiation' })],
      answerPendingQuestion: async () => {
        answered += 1;
        return true;
      },
    });

    const result = parse(await tools.answer_pending_question!.handler({
      context: makeContext('user-owner', { mcpCaller: { kind: 'human', permissions: [] } }),
      query: { questionId: 'neg-1', freeText: 'answer' },
    }));

    expect(result.success).toBe(true);
    expect(answered).toBe(1);
  });

  test('refuses to fabricate an answer with neither selectedOptions nor freeText', async () => {
    let answered = 0;
    const tools = captureTools({
      findPendingQuestions: async () => [question({ id: 'q1' })],
      answerPendingQuestion: async () => {
        answered += 1;
        return true;
      },
    });

    const result = parse(await tools.answer_pending_question!.handler({
      context: makeContext('user-owner'),
      query: { questionId: 'q1' },
    }));

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/no answer provided/i);
    expect(answered).toBe(0);
  });
});

describe('read_pending_questions — exact affected-domain permission projection (IND-608)', () => {
  test('a global manage:intents agent sees intent questions but not negotiation questions', async () => {
    const tools = captureTools({
      findPendingQuestions: async () => [
        question({ id: 'intent-q', mode: 'intent' }),
        question({ id: 'neg-q', mode: 'negotiation' }),
        question({ id: 'enrich-q', mode: 'enrichment' }),
      ],
    });

    const result = parse(await tools.read_pending_questions!.handler({
      context: makeContext('user-owner', { mcpCaller: intentsAgent }),
      query: {},
    }));

    expect(result.success).toBe(true);
    const ids = (result.data!.questions as Array<{ id: string }>).map((q) => q.id);
    expect(ids).toEqual(['intent-q']);
  });

  test('the owning human sees every mode', async () => {
    const tools = captureTools({
      findPendingQuestions: async () => [
        question({ id: 'intent-q', mode: 'intent' }),
        question({ id: 'neg-q', mode: 'negotiation' }),
      ],
    });

    const result = parse(await tools.read_pending_questions!.handler({
      context: makeContext('user-owner', { mcpCaller: { kind: 'human', permissions: [] } }),
      query: {},
    }));

    expect(result.success).toBe(true);
    const ids = (result.data!.questions as Array<{ id: string }>).map((q) => q.id);
    expect(ids).toEqual(['intent-q', 'neg-q']);
  });
});

describe('read_pending_questions — network visibility clamp (IND-608)', () => {
  test('a network-scoped agent only sees self-owned questions whose actor matches user+network', async () => {
    const tools = captureTools({
      findPendingQuestions: async () => [
        // Visible: self-owned mode, actor is the caller in the bound network.
        question({
          id: 'visible',
          mode: 'intent',
          actors: [{ userId: 'user-owner', networkId: 'network-1' }],
        } as Partial<PendingQuestionSummary>),
        // Hidden: correct user but a different network.
        question({
          id: 'foreign-network',
          mode: 'intent',
          actors: [{ userId: 'user-owner', networkId: 'network-2' }],
        } as Partial<PendingQuestionSummary>),
        // Hidden: negotiation mode is never self-owned for a network agent.
        question({
          id: 'negotiation-mode',
          mode: 'negotiation',
          actors: [{ userId: 'user-owner', networkId: 'network-1' }],
        } as Partial<PendingQuestionSummary>),
        // Hidden: a different user's question in the same network.
        question({
          id: 'other-user',
          mode: 'intent',
          actors: [{ userId: 'someone-else', networkId: 'network-1' }],
        } as Partial<PendingQuestionSummary>),
      ],
    });

    const result = parse(await tools.read_pending_questions!.handler({
      context: makeContext('user-owner', { networkId: 'network-1' }),
      query: {},
    }));

    expect(result.success).toBe(true);
    const ids = (result.data!.questions as Array<{ id: string }>).map((q) => q.id);
    expect(ids).toEqual(['visible']);
    expect(result.data!.scopeRestriction).toBeDefined();
  });
});
