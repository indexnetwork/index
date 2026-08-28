import { describe, expect, it, mock } from 'bun:test';

import { NegotiationGraphFactory } from '../negotiation.graph.js';
import { negotiationRoundReflectJobId } from '../negotiation.round-reflect.js';

const updatedAt = new Date('2026-07-21T00:00:00.000Z');

function task(state: 'paused' | 'completed' = 'paused') {
  return {
    id: 'task-1', conversationId: 'conversation-1', state, briefs: {}, createdAt: updatedAt, updatedAt,
    metadata: {
      type: 'negotiation' as const, opportunityId: 'opportunity-1', sourceUserId: 'user-1', candidateUserId: 'user-2',
      initiatorUserId: 'user-1', networkId: 'network-1', seats: { 'intent-1': { userId: 'user-1', batchId: 'batch-2' } },
      pause: { reason: 'needs_principal' as const },
    },
  };
}

function graph(overrides: Record<string, unknown> = {}) {
  const database = {
    getNegotiationTask: mock(async () => task()),
    expirePausedNegotiation: mock(async () => ({ ...task(), state: 'completed' as const })),
    createNegotiationOutcomeArtifact: mock(async () => undefined),
    ...overrides,
  };
  const roundLog = {
    appendNegotiationRoundLogEvent: mock(async () => undefined),
    readNegotiationRoundLogEvents: mock(async () => [
      { kind: 'opened' as const, taskId: 'task-1', batchId: 'batch-2', createdAt: updatedAt },
      { kind: 'opening_complete' as const, batchId: 'batch-2', createdAt: updatedAt },
      { kind: 'stopped' as const, taskId: 'task-1', batchId: 'batch-2', via: 'completed' as const, createdAt: updatedAt },
    ]),
  };
  const reflectEnqueue = mock(async () => undefined);
  return {
    database,
    roundLog,
    reflectEnqueue,
    graph: new NegotiationGraphFactory({ database: database as never, roundLog: roundLog as never, author: {} as never, reflectEnqueue }).createGraph(),
  };
}

describe('NegotiationGraph system expiry', () => {
  it('uses a BullMQ-safe id for a durable all-paused reflect', () => {
    expect(negotiationRoundReflectJobId('intent-1', 'batch-2', 'task-1.0')).toBe('reflect.intent-1.batch-2.task-1.0');
  });

  it('completes an eligible paused task without authoring a verdict and reflects its batch', async () => {
    const fixture = graph();

    const result = await fixture.graph.invoke({
      negotiationId: 'task-1', expire: { expectedUpdatedAt: updatedAt, reason: 'needs_principal' },
    });

    expect(result.status).toBe('resolved');
    expect(fixture.database.expirePausedNegotiation).toHaveBeenCalledWith({ taskId: 'task-1', expectedUpdatedAt: updatedAt, reason: 'needs_principal' });
    expect(fixture.database.createNegotiationOutcomeArtifact).not.toHaveBeenCalled();
    expect(fixture.reflectEnqueue).toHaveBeenCalledWith({
      userId: 'user-1', intentId: 'intent-1', batchId: 'batch-2', dedupeKey: 'task-1.2',
    });
  });

  it('leaves a changed task uncompleted and does not trigger round reflection', async () => {
    const fixture = graph({ expirePausedNegotiation: mock(async () => null) });

    const result = await fixture.graph.invoke({
      negotiationId: 'task-1', expire: { expectedUpdatedAt: updatedAt, reason: 'needs_principal' },
    });

    expect(result.status).toBe('paused');
    expect(fixture.reflectEnqueue).not.toHaveBeenCalled();
  });
});
