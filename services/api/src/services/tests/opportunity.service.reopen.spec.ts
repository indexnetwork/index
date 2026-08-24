/**
 * OpportunityService.reopenOpportunity — the user's lever to re-run a dead
 * pairing (POST /api/opportunities/:id/reopen).
 *
 * Exercised with a stubbed database and a stubbed re-run queue, so the
 * authorization rule, the reopenable-status rule, and the enqueue are pinned
 * without Postgres or Redis. The write itself (status flip and its
 * millisecond-truncated `updated_at`) is pinned against the real database in
 * `src/adapters/tests/opportunity-reopen.database.spec.ts`.
 */

import { config } from 'dotenv';
config({ path: '.env.test', override: true });

import { describe, it, expect, mock } from 'bun:test';
import type { Opportunity, OpportunityControllerDatabase } from '@indexnetwork/protocol';
import { OpportunityService, type NegotiationRerunQueue, type OpportunityReopenDatabase } from '../opportunity.service';
import type { ReopenOpportunityResult } from '../../adapters/opportunity.database.adapter';

const ACTOR_ID = 'user-actor-001';
const PEER_ID = 'user-peer-002';
const STRANGER_ID = 'user-stranger-003';
const OPP_ID = 'opp-reopen-001';

function makeOpportunity(overrides: Partial<Opportunity> = {}): Opportunity {
  return {
    id: OPP_ID,
    detection: { source: 'opportunity_graph', timestamp: new Date().toISOString() },
    actors: [
      { networkId: 'idx-1', userId: ACTOR_ID, role: 'patient' },
      { networkId: 'idx-1', userId: PEER_ID, role: 'agent' },
    ],
    interpretation: { category: 'collaboration', reasoning: 'Strong match.', confidence: 0.85, signals: [] },
    context: { networkId: 'idx-1' },
    confidence: '0.85',
    status: 'rejected',
    createdAt: new Date(),
    updatedAt: new Date(),
    expiresAt: null,
    ...overrides,
  };
}

function makeService(
  opp: Opportunity | null,
  reopenResult: ReopenOpportunityResult | null,
  queueOverride?: NegotiationRerunQueue,
) {
  const db = {
    getOpportunity: mock(async () => opp),
  } as unknown as OpportunityControllerDatabase;
  const reopenDb: OpportunityReopenDatabase = {
    reopenOpportunityForRerun: mock(async () => reopenResult),
  };
  const queue: NegotiationRerunQueue = queueOverride ?? { addJob: mock(async () => ({ id: 'job-1' })) };
  const service = new OpportunityService(db, undefined, undefined, {}, undefined, {
    database: reopenDb,
    queue,
  });
  return { service, db, reopenDb, queue };
}

describe('OpportunityService.reopenOpportunity', () => {
  it('reopens for an actor and enqueues the re-run', async () => {
    const opp = makeOpportunity({ status: 'rejected' });
    const { service, reopenDb, queue } = makeService(opp, {
      reopened: { ...opp, status: 'stalled' } as never,
    });

    const result = await service.reopenOpportunity(OPP_ID, ACTOR_ID);

    expect(result).toEqual({ opportunityId: OPP_ID, status: 'stalled', enqueued: true });
    expect(reopenDb.reopenOpportunityForRerun).toHaveBeenCalledWith(OPP_ID);
    expect(queue.addJob).toHaveBeenCalledWith({ opportunityId: OPP_ID, userId: ACTOR_ID });
  });

  it('refuses a non-actor with 403 and never touches the row or the queue', async () => {
    const { service, reopenDb, queue } = makeService(makeOpportunity(), null);

    const result = await service.reopenOpportunity(OPP_ID, STRANGER_ID);

    expect(result).toEqual({ error: 'Not authorized to reopen this opportunity', status: 403 });
    expect(reopenDb.reopenOpportunityForRerun).not.toHaveBeenCalled();
    expect(queue.addJob).not.toHaveBeenCalled();
  });

  it('answers 409 with the task id while a negotiation is in flight', async () => {
    const { service, queue } = makeService(makeOpportunity({ status: 'stalled' }), {
      conflict: 'active_negotiation',
      taskId: 'task-live-1',
    });

    const result = await service.reopenOpportunity(OPP_ID, ACTOR_ID);

    expect(result).toMatchObject({ status: 409, taskId: 'task-live-1' });
    expect(queue.addJob).not.toHaveBeenCalled();
  });

  it.each(['pending', 'accepted'] as const)(
    'answers 409 for a %s match — a live or won match is not a dead end to recover from',
    async (status) => {
      const { service, queue } = makeService(makeOpportunity({ status }), {
        conflict: 'not_reopenable',
        status,
      });

      const result = await service.reopenOpportunity(OPP_ID, ACTOR_ID);

      expect(result).toMatchObject({ status: 409 });
      expect('error' in result && result.error).toContain(status);
      expect(queue.addJob).not.toHaveBeenCalled();
    },
  );

  it('404s a network-scoped agent principal reaching outside its network', async () => {
    const { service, reopenDb } = makeService(makeOpportunity(), null);

    const result = await service.reopenOpportunity(OPP_ID, ACTOR_ID, { networkScopeId: 'idx-other' });

    expect(result).toEqual({ error: 'Opportunity not found', status: 404 });
    expect(reopenDb.reopenOpportunityForRerun).not.toHaveBeenCalled();
  });

  it('404s an unknown opportunity before any authorization work', async () => {
    const { service, reopenDb } = makeService(null, null);

    const result = await service.reopenOpportunity(OPP_ID, ACTOR_ID);

    expect(result).toEqual({ error: 'Opportunity not found', status: 404 });
    expect(reopenDb.reopenOpportunityForRerun).not.toHaveBeenCalled();
  });

  it('reports the failed enqueue instead of claiming a run that was never queued', async () => {
    const opp = makeOpportunity({ status: 'expired' });
    const { service } = makeService(
      opp,
      { reopened: { ...opp, status: 'stalled' } as never },
      { addJob: mock(async () => { throw new Error('redis down'); }) },
    );

    const result = await service.reopenOpportunity(OPP_ID, ACTOR_ID);

    expect(result).toMatchObject({ status: 500 });
    expect('error' in result && result.error).toContain('retry');
  });
});
