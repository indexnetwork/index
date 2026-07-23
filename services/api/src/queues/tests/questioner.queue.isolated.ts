/** Unit tests for QuestionerQueue payload-to-persistence mapping. */
process.env.DATABASE_URL = process.env.DATABASE_URL ?? 'postgresql://unused:unused@localhost:5432/unused';

import { afterEach, describe, expect, it } from 'bun:test';

import { QuestionerQueue } from '../questioner.queue';
import type { PersistableQuestion, QuestionGenerationResult } from '@indexnetwork/protocol';

describe('QuestionerQueue', () => {
  const queues: QuestionerQueue[] = [];

  afterEach(async () => {
    await Promise.all(queues.splice(0).map((queue) => queue.close().catch(() => undefined)));
  });

  it('persists scoped question actors with the network scope id', async () => {
    let captured: PersistableQuestion[] = [];
    const result: QuestionGenerationResult = {
      questions: [
        {
          title: 'Focus',
          prompt: 'Which collaboration focus matters most?',
          options: [
            { label: 'Build', description: 'Build together' },
            { label: 'Learn', description: 'Exchange knowledge' },
          ],
          multiSelect: false,
        },
      ],
      strategies: ['surface_missing_detail'],
      underspecificationTypes: ['missing_constraint'],
    };
    const queue = new QuestionerQueue({
      adapter: {
        persist: async (batch) => {
          captured = batch;
          return ['question-1'];
        },
      },
      agent: { invoke: async () => result },
    });
    queues.push(queue);

    await queue.processJob('generate_questions', {
      mode: 'discovery',
      userId: 'user-1',
      sourceType: 'discovery',
      sourceId: 'session-1',
      context: {} as never,
      scopeType: 'network',
      scopeId: 'network-1',
      conversationId: 'session-1',
    });

    expect(captured).toHaveLength(1);
    expect(captured[0].detection.underspecificationType).toBeUndefined();
    expect(captured[0].underspecificationType).toBe('missing_constraint');
    expect(captured[0].actors).toEqual([
      { userId: 'user-1', role: 'subject', networkId: 'network-1' },
    ]);
  });

  it('persists selected intent scope as detection.triggeredBy without actor networkId', async () => {
    let captured: PersistableQuestion[] = [];
    const queue = new QuestionerQueue({
      adapter: {
        persist: async (batch) => {
          captured = batch;
          return ['question-1'];
        },
      },
      agent: {
        invoke: async () => ({
          questions: [
            {
              title: 'Focus',
              prompt: 'Which collaboration focus matters most?',
              options: [
                { label: 'Build', description: 'Build together' },
                { label: 'Learn', description: 'Exchange knowledge' },
              ],
              multiSelect: false,
            },
          ],
          strategies: ['surface_missing_detail'],
          underspecificationTypes: ['missing_constraint'],
        }),
      },
    });
    queues.push(queue);

    await queue.processJob('generate_questions', {
      mode: 'discovery',
      userId: 'user-1',
      sourceType: 'discovery',
      sourceId: 'session-1',
      context: {} as never,
      scopeType: 'intent',
      scopeId: 'intent-1',
      conversationId: 'session-1',
    });

    expect(captured[0].actors).toEqual([{ userId: 'user-1', role: 'subject' }]);
    expect(captured[0].detection.triggeredBy).toBe('intent-1');
  });

  it('persists triggeredByIntentId as detection.triggeredBy alongside a network scope', async () => {
    let captured: PersistableQuestion[] = [];
    const queue = new QuestionerQueue({
      adapter: {
        persist: async (batch) => {
          captured = batch;
          return ['question-1'];
        },
      },
      agent: {
        invoke: async () => ({
          questions: [
            {
              title: 'Focus',
              prompt: 'Which collaboration focus matters most?',
              options: [
                { label: 'Build', description: 'Build together' },
                { label: 'Learn', description: 'Exchange knowledge' },
              ],
              multiSelect: false,
            },
          ],
          strategies: ['surface_missing_detail'],
          underspecificationTypes: ['missing_constraint'],
        }),
      },
    });
    queues.push(queue);

    await queue.processJob('generate_questions', {
      mode: 'discovery',
      userId: 'user-1',
      sourceType: 'discovery',
      sourceId: 'session-1',
      context: {} as never,
      scopeType: 'network',
      scopeId: 'network-1',
      triggeredByIntentId: 'intent-1',
      conversationId: 'session-1',
    });

    // Intent linkage and network scope coexist: triggeredBy from the intent,
    // actor networkId from the network scope.
    expect(captured[0].detection.triggeredBy).toBe('intent-1');
    expect(captured[0].actors).toEqual([
      { userId: 'user-1', role: 'subject', networkId: 'network-1' },
    ]);
  });

  it('skips a standalone intent-scoped job before agent invocation and persistence when paused', async () => {
    let invoked = false;
    let persisted = false;
    const queue = new QuestionerQueue({
      adapter: {
        persist: async () => {
          persisted = true;
          return ['question-1'];
        },
      },
      agent: {
        invoke: async () => {
          invoked = true;
          return null;
        },
      },
      getIntentLifecycle: async (intentId) => ({ id: intentId, status: 'PAUSED', archivedAt: null }),
    });
    queues.push(queue);

    await queue.processJob('generate_questions', {
      mode: 'intent',
      userId: 'user-1',
      sourceType: 'intent',
      sourceId: 'intent-1',
      context: {} as never,
    });

    expect(invoked).toBe(false);
    expect(persisted).toBe(false);
  });

  it('copies uptake purpose, scopes the actor, and caps generator output to one', async () => {
    let captured: PersistableQuestion[] = [];
    let invoked = 0;
    const generated = {
      title: 'Readiness',
      prompt: 'Is the practical setup clear?',
      options: [{ label: 'Yes', description: 'Proceed' }, { label: 'No', description: 'Clarify' }],
      multiSelect: false,
    };
    const queue = new QuestionerQueue({
      adapter: {
        findPending: async () => [],
        persist: async (batch) => { captured = batch; return ['question-1']; },
      },
      agent: {
        invoke: async () => {
          invoked += 1;
          return {
            questions: [generated, generated],
            strategies: ['surface_missing_detail', 'surface_missing_detail'],
            underspecificationTypes: [null, 'missing_constraint'],
          };
        },
      },
    });
    queues.push(queue);

    await queue.processJob('generate_questions', {
      mode: 'negotiation', purpose: 'uptake', userId: 'user-1',
      sourceType: 'opportunity', sourceId: 'opp-1',
      scopeType: 'network', scopeId: 'network-1',
      context: {
        purpose: 'uptake', negotiationId: 'opp-1', counterpartyHint: 'A builder',
        indexContext: 'Community', proposedActivity: 'Host a workshop',
      },
    });

    expect(invoked).toBe(1);
    expect(captured).toHaveLength(1);
    expect(captured[0].detection.purpose).toBe('uptake');
    expect(captured[0].underspecificationType).toBeNull();
    expect(captured[0].actors).toEqual([{ userId: 'user-1', role: 'subject', networkId: 'network-1' }]);
  });

  it('deduplicates uptake before invoking the generator', async () => {
    let invoked = 0;
    const queue = new QuestionerQueue({
      adapter: {
        findPending: async () => [{ id: 'existing' } as never],
        persist: async () => [],
      },
      agent: { invoke: async () => { invoked += 1; return null; } },
    });
    queues.push(queue);
    await queue.processJob('generate_questions', {
      mode: 'negotiation', purpose: 'uptake', userId: 'user-1',
      sourceType: 'opportunity', sourceId: 'opp-1',
      context: {
        purpose: 'uptake', negotiationId: 'opp-1', counterpartyHint: 'Builder',
        indexContext: 'Community', proposedActivity: 'Activity',
      },
    });
    expect(invoked).toBe(0);
  });

  it('delegates privacy-minimal recovery jobs to the dedicated service', async () => {
    let captured: unknown;
    const queue = new QuestionerQueue({
      adapter: { persist: async () => [] },
      recoveryService: {
        recover: async (input) => { captured = input; return null; },
      },
    });
    queues.push(queue);

    await queue.processJob('generate_recovery_refinement', {
      source: 'discovery_run',
      recipientUserId: 'user-1',
      intentId: 'intent-1',
      runId: 'run-1',
    });
    expect(captured).toEqual({
      source: 'discovery_run', recipientUserId: 'user-1', intentId: 'intent-1', runId: 'run-1',
    });
  });

  it('does not let recovery questions consume the independent pool pending budget', async () => {
    let persisted = false;
    const recoveryRows = Array.from({ length: 5 }, (_, index) => ({
      id: `recovery-${index}`,
      detection: { purpose: 'recovery', mode: 'intent' },
    })) as never[];
    const queue = new QuestionerQueue({
      adapter: {
        persist: async () => [],
        findPending: async () => recoveryRows,
        listPoolQuestionLabels: async () => [],
        persistFreshPoolQuestion: async () => { persisted = true; return 'pool-question'; },
      },
    });
    queues.push(queue);

    const opportunityId = '00000000-0000-4000-8000-000000000001';
    await queue.processJob('generate_questions', {
      mode: 'pool_discovery', userId: 'user-1', sourceType: 'intent', sourceId: 'intent-1',
      triggeredByIntentId: 'intent-1',
      context: {
        intentId: 'intent-1', intentText: 'Find climate builders', poolSize: 8,
        opportunityIds: [opportunityId], minedAt: new Date().toISOString(),
        discriminators: [{
          label: 'Stage', questionSeed: 'Which stage matters?', sides: ['Early', 'Growth'],
          sideCounts: { Early: 1, Growth: 0 }, voi: 0.8, evidenceRate: 1,
          assignments: [{ opportunityId, side: 'Early' }],
        }],
      },
    });
    expect(persisted).toBe(true);
  });

  it('omits actor networkId for unscoped question jobs', async () => {
    let captured: PersistableQuestion[] = [];
    const queue = new QuestionerQueue({
      adapter: {
        persist: async (batch) => {
          captured = batch;
          return ['question-1'];
        },
      },
      agent: {
        invoke: async () => ({
          questions: [
            {
              title: 'Focus',
              prompt: 'Which collaboration focus matters most?',
              options: [
                { label: 'Build', description: 'Build together' },
                { label: 'Learn', description: 'Exchange knowledge' },
              ],
              multiSelect: false,
            },
          ],
          strategies: ['surface_missing_detail'],
          underspecificationTypes: ['missing_constraint'],
        }),
      },
    });
    queues.push(queue);

    await queue.processJob('generate_questions', {
      mode: 'discovery',
      userId: 'user-1',
      sourceType: 'discovery',
      sourceId: 'session-1',
      context: {} as never,
    });

    expect(captured[0].actors).toEqual([{ userId: 'user-1', role: 'subject' }]);
  });
});
