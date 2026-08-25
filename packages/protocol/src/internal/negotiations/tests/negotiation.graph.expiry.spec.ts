import { describe, expect, it, mock } from 'bun:test';

import { NegotiationGraphFactory } from '../negotiation.graph.js';

const updatedAt = new Date('2026-07-21T00:00:00.000Z');

function task(state: 'paused' | 'completed' = 'paused') {
  return {
    id: 'task-1', conversationId: 'conversation-1', state, briefs: {}, createdAt: updatedAt, updatedAt,
    metadata: {
      type: 'negotiation' as const, opportunityId: 'opportunity-1', sourceUserId: 'user-1', candidateUserId: 'user-2',
      initiatorUserId: 'user-1', networkId: 'network-1', seats: { 'intent-1': { userId: 'user-1', round: 2 } },
      drainGeneration: 0,
      pause: { reason: 'needs_principal' as const },
    },
  };
}

function graph(overrides: Record<string, unknown> = {}) {
  const database = {
    getNegotiationTask: mock(async () => task()),
    expirePausedNegotiation: mock(async () => ({ ...task(), state: 'completed' as const })),
    createNegotiationOutcomeArtifact: mock(async () => undefined),
    getIntentNegotiationRound: mock(async () => ({ round: 2, roundSize: 1, kickoffStartedAt: updatedAt })),
    getNegotiationTasksForIntentRound: mock(async () => [task('completed')]),
    ...overrides,
  };
  const reflectEnqueue = mock(async () => undefined);
  return {
    database,
    reflectEnqueue,
    graph: new NegotiationGraphFactory({ database: database as never, author: {} as never, reflectEnqueue }).createGraph(),
  };
}

describe('NegotiationGraph system expiry', () => {
  it('completes an eligible paused task without authoring a verdict and reflects its round', async () => {
    const fixture = graph();

    const result = await fixture.graph.invoke({
      negotiationId: 'task-1', expire: { expectedUpdatedAt: updatedAt, reason: 'needs_principal' },
    });

    expect(result.status).toBe('resolved');
    expect(fixture.database.expirePausedNegotiation).toHaveBeenCalledWith({ taskId: 'task-1', expectedUpdatedAt: updatedAt, reason: 'needs_principal' });
    expect(fixture.database.createNegotiationOutcomeArtifact).not.toHaveBeenCalled();
    expect(fixture.reflectEnqueue).toHaveBeenCalledWith({
      userId: 'user-1', intentId: 'intent-1', round: 2, generation: 'task-1.0',
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
