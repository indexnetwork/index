/** Unit tests for QuestionerQueue payload-to-persistence mapping. */
process.env.DATABASE_URL = process.env.DATABASE_URL ?? 'postgresql://unused:unused@localhost:5432/unused';

import { afterEach, describe, expect, it } from 'bun:test';

import { QuestionerQueue } from '../questioner.queue';
import type { PersistableQuestion, QuestionGenerationResult } from '@indexnetwork/protocol';

describe('QuestionerQueue', () => {
  const queues: QuestionerQueue[] = [];
  const uptakeCandidate = {
    purpose: 'uptake' as const,
    recipientUserId: 'user-1',
    recipientIntentId: 'intent-1',
    opportunityId: 'opp-1',
    networkId: 'network-1',
    counterpartyUserId: 'user-2',
    counterpartyIntentId: 'intent-2',
    counterpartyFelicityAuthority: 45,
  };
  const uptakeAdmission = {
    version: 1 as const,
    ...uptakeCandidate,
    intentFingerprint: 'fingerprint-1',
    opportunityStatus: 'pending' as const,
    opportunityUpdatedAt: '2026-07-23T00:00:00.000Z',
  };

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

  it('drops retired intent-mode payloads before any generation or persistence', async () => {
    let invoked = false;
    let persisted = false;
    const queue = new QuestionerQueue({
      adapter: {
        persist: async () => { persisted = true; return []; },
      },
      agent: {
        invoke: async () => {
          invoked = true;
          return null;
        },
      },
    });
    queues.push(queue);

    await queue.processJob('generate_questions', {
      mode: 'intent',
      userId: 'user-1',
      sourceType: 'intent',
      sourceId: 'intent-1',
      context: {
        intentId: 'intent-1',
        payload: 'Find a climate analytics collaborator',
      },
    });

    expect(invoked).toBe(false);
    expect(persisted).toBe(false);
  });

  it('stamps task-backed follow-up provenance on every generated ordinal without changing cardinality', async () => {
    const captured: PersistableQuestion[][] = [];
    const candidate = {
      purpose: 'stalled_followup' as const,
      recipientUserId: 'user-1',
      recipientIntentId: 'intent-1',
      opportunityId: 'opp-1',
      taskId: 'task-1',
      networkId: 'network-1',
    };
    const admission = {
      version: 1 as const,
      ...candidate,
      intentFingerprint: 'fingerprint-1',
      opportunityStatus: 'stalled' as const,
      opportunityUpdatedAt: '2026-07-23T00:00:00.000Z',
      taskState: 'completed' as const,
      taskUpdatedAt: '2026-07-23T00:00:01.000Z',
    };
    const generated = {
      title: 'Scope',
      prompt: 'Which scope best fits your signal?',
      options: [{ label: 'Narrow', description: 'Focus it' }, { label: 'Broad', description: 'Keep range' }],
      multiSelect: false,
    };
    const queue = new QuestionerQueue({
      adapter: {
        findPending: async () => [],
        persist: async () => [],
        prepareNegotiationQuestion: async () => admission,
        persistFreshNegotiationQuestions: async (batch) => { captured.push(batch); return ['q-1', 'q-2']; },
      },
      agent: { invoke: async () => ({
        questions: [generated, { ...generated, title: 'Timing' }],
        strategies: ['refine_intent', 'surface_missing_detail'],
        underspecificationTypes: ['missing_constraint', 'missing_constituent'],
      }) },
    });
    queues.push(queue);

    await queue.processJob('generate_questions', {
      mode: 'negotiation',
      purpose: 'stalled_followup',
      userId: 'user-1',
      sourceType: 'opportunity',
      sourceId: 'opp-1',
      negotiation: candidate,
      context: {
        negotiationId: 'task-1',
        counterpartyHint: 'the other participant',
        indexContext: 'the selected network',
        outcomeReason: 'stalled',
        recipientIntent: 'Find a collaborator',
      },
    });

    expect(captured[0]).toHaveLength(2);
    expect(captured[0].map((question) => question.detection.negotiation?.questionOrdinal)).toEqual([0, 1]);
    expect(captured[0][0].conversationId).toBeUndefined();
    expect(captured[0][0].detection.messageId).toBeUndefined();
  });

  it('stamps exact inflight task provenance for the current speaker', async () => {
    let captured: PersistableQuestion[] = [];
    const candidate = {
      purpose: 'inflight_consultation' as const,
      recipientUserId: 'user-candidate',
      recipientIntentId: 'intent-candidate',
      opportunityId: 'opp-1',
      taskId: 'task-inflight',
      networkId: 'network-1',
    };
    const admission = {
      version: 1 as const,
      ...candidate,
      intentFingerprint: 'fingerprint-candidate',
      opportunityStatus: 'negotiating' as const,
      opportunityUpdatedAt: '2026-07-23T00:00:00.000Z',
      taskState: 'input_required' as const,
      taskUpdatedAt: '2026-07-23T00:00:01.000Z',
    };
    const queue = new QuestionerQueue({
      adapter: {
        findPending: async () => [], persist: async () => [],
        prepareNegotiationQuestion: async () => admission,
        persistFreshNegotiationQuestions: async (batch) => { captured = batch; return ['q-inflight']; },
      },
      agent: { invoke: async () => ({
        questions: [{
          title: 'Disclosure', prompt: 'May I share the timing?',
          options: [{ label: 'Share', description: 'Share it' }, { label: 'Private', description: 'Keep private' }],
          multiSelect: false,
        }],
        strategies: ['reflective_summary'], underspecificationTypes: [null],
      }) },
    });
    queues.push(queue);
    await queue.processJob('generate_questions', {
      mode: 'negotiation_inflight', purpose: 'inflight_consultation',
      userId: 'user-candidate', sourceType: 'opportunity', sourceId: 'opp-1',
      negotiation: candidate,
      context: {
        negotiationId: 'task-inflight', counterpartyHint: 'the other participant',
        disclosureSubject: 'timing', indexContext: 'the selected network',
      },
    });
    expect(captured[0].detection.negotiation).toEqual({ ...admission, questionOrdinal: 0 });
    expect(captured[0].actors).toEqual([{ userId: 'user-candidate', networkId: 'network-1', role: 'subject' }]);
  });

  it('skips before generation when authoritative negotiation admission drifts', async () => {
    let invoked = false;
    const queue = new QuestionerQueue({
      adapter: {
        findPending: async () => [],
        persist: async () => [],
        prepareNegotiationQuestion: async () => null,
        persistFreshNegotiationQuestions: async () => [],
      },
      agent: { invoke: async () => { invoked = true; return null; } },
    });
    queues.push(queue);
    await queue.processJob('generate_questions', {
      mode: 'negotiation', purpose: 'uptake', userId: 'user-1',
      sourceType: 'opportunity', sourceId: 'opp-1', negotiation: uptakeCandidate,
      context: {
        purpose: 'uptake', negotiationId: 'opp-1', counterpartyHint: 'the other participant',
        indexContext: 'the selected network',
        proposedActivity: 'a potential collaboration that may require clarification before you decide',
      },
    });
    expect(invoked).toBe(false);
  });

  it('fails closed when final pre-insert revalidation drifts', async () => {
    let invoked = false;
    let ordinaryPersisted = false;
    const queue = new QuestionerQueue({
      adapter: {
        findPending: async () => [],
        persist: async () => { ordinaryPersisted = true; return []; },
        prepareNegotiationQuestion: async () => uptakeAdmission,
        persistFreshNegotiationQuestions: async () => [],
      },
      agent: { invoke: async () => {
        invoked = true;
        return {
          questions: [{
            title: 'Readiness', prompt: 'Is the practical setup clear?',
            options: [{ label: 'Yes', description: 'Proceed' }, { label: 'No', description: 'Clarify' }],
            multiSelect: false,
          }],
          strategies: ['surface_missing_detail'], underspecificationTypes: [null],
        };
      } },
    });
    queues.push(queue);
    await queue.processJob('generate_questions', {
      mode: 'negotiation', purpose: 'uptake', userId: 'user-1',
      sourceType: 'opportunity', sourceId: 'opp-1', negotiation: uptakeCandidate,
      context: {
        purpose: 'uptake', negotiationId: 'opp-1', counterpartyHint: 'the other participant',
        indexContext: 'the selected network',
        proposedActivity: 'a potential collaboration that may require clarification before you decide',
      },
    });
    expect(invoked).toBe(true);
    expect(ordinaryPersisted).toBe(false);
  });

  it('treats only the named provenance constraint as success-equivalent', async () => {
    const generated = {
      title: 'Readiness', prompt: 'Is the setup clear?',
      options: [{ label: 'Yes', description: 'Proceed' }, { label: 'No', description: 'Clarify' }],
      multiSelect: false,
    };
    const makeQueue = (constraintName: string) => new QuestionerQueue({
      adapter: {
        findPending: async () => [], persist: async () => [],
        prepareNegotiationQuestion: async () => uptakeAdmission,
        persistFreshNegotiationQuestions: async () => {
          throw { code: '23505', constraint_name: constraintName };
        },
      },
      agent: { invoke: async () => ({
        questions: [generated], strategies: ['surface_missing_detail'], underspecificationTypes: [null],
      }) },
    });
    const input = {
      mode: 'negotiation' as const, purpose: 'uptake' as const, userId: 'user-1',
      sourceType: 'opportunity', sourceId: 'opp-1', negotiation: uptakeCandidate,
      context: {
        purpose: 'uptake' as const, negotiationId: 'opp-1', counterpartyHint: 'the other participant',
        indexContext: 'the selected network',
        proposedActivity: 'a potential collaboration that may require clarification before you decide',
      },
    };
    const winningRace = makeQueue('questions_negotiation_provenance_uniq');
    queues.push(winningRace);
    await expect(winningRace.processJob('generate_questions', input)).resolves.toBeUndefined();

    const unrelated = makeQueue('some_other_unique_constraint');
    queues.push(unrelated);
    await expect(unrelated.processJob('generate_questions', input)).rejects.toMatchObject({
      constraint_name: 'some_other_unique_constraint',
    });
  });

  it('persists no inflight row when the generator returns zero questions', async () => {
    let persisted = false;
    const candidate = {
      purpose: 'inflight_consultation' as const,
      recipientUserId: 'user-1', recipientIntentId: 'intent-1', opportunityId: 'opp-1',
      taskId: 'task-1', networkId: 'network-1',
    };
    const queue = new QuestionerQueue({
      adapter: {
        findPending: async () => [], persist: async () => [],
        prepareNegotiationQuestion: async () => ({
          version: 1, ...candidate, intentFingerprint: 'fp', opportunityStatus: 'negotiating',
          opportunityUpdatedAt: '2026-07-23T00:00:00.000Z', taskState: 'input_required',
          taskUpdatedAt: '2026-07-23T00:00:01.000Z',
        }),
        persistFreshNegotiationQuestions: async () => { persisted = true; return []; },
      },
      agent: { invoke: async () => null },
    });
    queues.push(queue);
    await queue.processJob('generate_questions', {
      mode: 'negotiation_inflight', purpose: 'inflight_consultation', userId: 'user-1',
      sourceType: 'opportunity', sourceId: 'opp-1', negotiation: candidate,
      context: {
        negotiationId: 'task-1', counterpartyHint: 'the other participant',
        indexContext: 'the selected network', disclosureSubject: 'budget range',
      },
    });
    expect(persisted).toBe(false);
  });

  it('rejects crossed negotiation mode/purpose contracts before generation', async () => {
    let invoked = 0;
    const queue = new QuestionerQueue({
      adapter: { findPending: async () => [], persist: async () => [] },
      agent: { invoke: async () => { invoked += 1; return null; } },
    });
    queues.push(queue);
    const crossed = [
      {
        mode: 'negotiation', purpose: 'inflight_consultation', negotiation: {
          purpose: 'inflight_consultation', recipientUserId: 'user-1', recipientIntentId: 'intent-1',
          opportunityId: 'opp-1', taskId: 'task-1', networkId: 'network-1',
        },
        context: { negotiationId: 'task-1', counterpartyHint: 'the other participant', indexContext: 'the selected network', disclosureSubject: 'timing' },
      },
      {
        mode: 'negotiation_inflight', purpose: 'stalled_followup', negotiation: {
          purpose: 'stalled_followup', recipientUserId: 'user-1', recipientIntentId: 'intent-1',
          opportunityId: 'opp-1', taskId: 'task-1', networkId: 'network-1',
        },
        context: { negotiationId: 'task-1', counterpartyHint: 'the other participant', indexContext: 'the selected network', outcomeReason: 'stalled', recipientIntent: 'Find help' },
      },
      {
        mode: 'negotiation_inflight', purpose: 'uptake', negotiation: uptakeCandidate,
        context: { purpose: 'uptake', negotiationId: 'opp-1', counterpartyHint: 'the other participant', indexContext: 'the selected network', proposedActivity: 'a potential collaboration that may require clarification before you decide' },
      },
    ];
    for (const input of crossed) {
      await queue.processJob('generate_questions', {
        ...input,
        userId: 'user-1', sourceType: 'opportunity', sourceId: 'opp-1',
      } as never);
    }
    expect(invoked).toBe(0);
  });

  it('rejects tainted visible negotiation output before final persistence', async () => {
    let persisted = false;
    const queue = new QuestionerQueue({
      adapter: {
        findPending: async () => [], persist: async () => [],
        prepareNegotiationQuestion: async () => uptakeAdmission,
        persistFreshNegotiationQuestions: async () => { persisted = true; return ['q-1']; },
      },
      agent: { invoke: async () => ({
        questions: [{
          title: "Alice's profile",
          prompt: 'PRIVATE TRANSCRIPT matchReason 123e4567-e89b-12d3-a456-426614174000',
          options: [
            { label: 'Same event', description: 'They both attended the same event' },
            { label: 'No', description: 'Do not share' },
          ],
          multiSelect: false,
          evidence: 'internal opportunityId',
        }],
        strategies: ['surface_missing_detail'], underspecificationTypes: [null],
      }) },
    });
    queues.push(queue);
    await queue.processJob('generate_questions', {
      mode: 'negotiation', purpose: 'uptake', userId: 'user-1',
      sourceType: 'opportunity', sourceId: 'opp-1', negotiation: uptakeCandidate,
      context: {
        purpose: 'uptake', negotiationId: 'opp-1', counterpartyHint: 'the other participant',
        indexContext: 'the selected network',
        proposedActivity: 'a potential collaboration that may require clarification before you decide',
      },
    });
    expect(persisted).toBe(false);
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
