/**
 * The owner verdict must END the pairing's negotiation (D23).
 *
 * The round's reflect trigger counts negotiation tasks still in `working`
 * (`countActiveNegotiationsForRound`). Before this fix an ordinary user reject
 * flipped only the opportunity, so its task stayed `working` forever: the round
 * never reached zero and `reflect:{intentId}:{round}` was never enqueued.
 *
 * The test drives the REAL `NegotiationGraph` over a fake database — the same
 * `resolve` production runs — rather than asserting that a mock was called, so
 * the count and the enqueue are observed, not stipulated.
 */
/** Config */
import { config } from 'dotenv';
config({ path: '.env.test', override: true });

import { describe, it, expect, mock } from 'bun:test';

import { NegotiationGraphFactory } from '@indexnetwork/protocol';
import type { NegotiationGraphDatabase, NegotiationTaskRow, NegotiationRoundReflectJobData, Opportunity, OpportunityControllerDatabase, OpportunityStatus } from '@indexnetwork/protocol';

import { OpportunityService, type OwnerVerdictNegotiationCloser } from '../opportunity.service';

const USER_A = 'user-a-001';
const USER_B = 'user-b-002';
const OPP_ID = 'opp-negotiated-001';
const INTENT_ID = 'intent-001';
const NEGOTIATION_ID = 'task-negotiation-001';
const ROUND = 3;

/** One negotiating pairing, shared by both fakes so status writes are observable. */
function negotiatedOpportunity(): Opportunity {
  return {
    id: OPP_ID,
    detection: { source: 'opportunity_graph', timestamp: new Date().toISOString(), triggeredBy: INTENT_ID },
    actors: [
      { networkId: 'idx-1', userId: USER_A, role: 'patient', intent: INTENT_ID },
      { networkId: 'idx-1', userId: USER_B, role: 'agent' },
    ],
    interpretation: { category: 'collaboration', reasoning: 'Shared interests.', confidence: 0.85, signals: [] },
    context: { networkId: 'idx-1' },
    confidence: '0.85',
    status: 'negotiating',
    createdAt: new Date(),
    updatedAt: new Date(),
    expiresAt: null,
  } as Opportunity;
}

function negotiationTask(): NegotiationTaskRow {
  return {
    id: NEGOTIATION_ID,
    conversationId: 'conv-negotiation-001',
    state: 'working',
    briefs: { [USER_A]: 'Reach out about the collaboration.' },
    metadata: {
      type: 'negotiation',
      opportunityId: OPP_ID,
      sourceUserId: USER_A,
      candidateUserId: USER_B,
      initiatorUserId: USER_A,
      networkId: 'idx-1',
      seats: { [INTENT_ID]: { userId: USER_A, round: ROUND } },
    },
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

/**
 * The world both the opportunity service and the negotiation graph write into:
 * one opportunity row and one negotiation task, plus the reflect enqueue the
 * all-paused check calls.
 */
function createWorld() {
  const opportunity = negotiatedOpportunity();
  const task = negotiationTask();
  const reflectJobs: NegotiationRoundReflectJobData[] = [];
  const artifacts: Array<{ verdict: string; reasoning?: string }> = [];

  const negotiationDb = {
    getOpportunity: async () => opportunity,
    getNegotiationTask: async (id: string) => (id === task.id ? task : null),
    getNegotiationTaskForOpportunity: async (opportunityId: string) =>
      opportunityId === OPP_ID && task.state !== 'completed' ? task : null,
    createNegotiationOutcomeArtifact: async (_taskId: string, outcome: { verdict: string; reasoning?: string }) => {
      artifacts.push(outcome);
    },
    updateNegotiationTaskState: async (_taskId: string, state: NegotiationTaskRow['state']) => {
      task.state = state;
      return task;
    },
    updateOpportunityStatus: async (id: string, status: OpportunityStatus) => {
      opportunity.status = status;
      return { id, status };
    },
    countActiveNegotiationsForRound: async (intentId: string, round: number) =>
      task.metadata.seats[intentId]?.round === round && task.state === 'working' ? 1 : 0,
    getIntentNegotiationRound: async (intentId: string) => ({
      round: task.metadata.seats[intentId]?.round ?? 0,
      roundSize: 1,
      kickoffStartedAt: null,
    }),
  } as unknown as NegotiationGraphDatabase;

  const graph = new NegotiationGraphFactory({
    database: negotiationDb,
    reflectEnqueue: async (job) => {
      reflectJobs.push(job);
    },
  }).createGraph();

  const closer: OwnerVerdictNegotiationCloser = {
    liveNegotiationId: async (opportunityId) =>
      (await negotiationDb.getNegotiationTaskForOpportunity(opportunityId))?.id ?? null,
    resolve: (input) => graph.invoke(input),
  };

  const opportunityDb = {
    getOpportunity: mock(async () => opportunity),
    updateOpportunityStatus: mock(async (_id: string, status: OpportunityStatus) => {
      opportunity.status = status;
      return opportunity;
    }),
    stampOpportunityActorAction: mock(async (_id: string, actorUserId: string, status: OpportunityStatus) => {
      opportunity.status = status;
      opportunity.actors = opportunity.actors.map((actor) =>
        actor.userId === actorUserId ? { ...actor, actedAt: new Date().toISOString() } : actor,
      );
      return opportunity;
    }),
    acceptSiblingOpportunities: mock(async () => {}),
    upsertContactMembership: mock(async () => {}),
    getOrCreateDM: mock(async () => ({ id: 'conv-dm-001' })),
    unhideConversation: mock(async () => {}),
  } as unknown as OpportunityControllerDatabase;

  const service = new OpportunityService(opportunityDb, undefined, undefined, {}, undefined, {}, closer);

  return { opportunity, task, reflectJobs, artifacts, negotiationDb, service };
}

describe('OpportunityService owner verdict closes the negotiation', () => {
  it('a user reject drops the round to zero active negotiations and enqueues reflect', async () => {
    const world = createWorld();

    // Before: the round still has one negotiation holding it open.
    expect(await world.negotiationDb.countActiveNegotiationsForRound(INTENT_ID, ROUND)).toBe(1);

    const result = await world.service.updateOpportunityStatus(OPP_ID, 'rejected', USER_A);
    expect('error' in result).toBe(false);

    expect(world.opportunity.status).toBe('rejected');
    expect(world.task.state).toBe('completed');
    expect(await world.negotiationDb.countActiveNegotiationsForRound(INTENT_ID, ROUND)).toBe(0);
    expect(world.reflectJobs).toEqual([{ userId: USER_A, intentId: INTENT_ID, round: ROUND }]);
    expect(world.artifacts).toEqual([
      { verdict: 'reject', reasoning: 'Closed by the owner declining this match.' },
    ]);
  });

  it('a user accept closes the negotiation without downgrading the accepted opportunity', async () => {
    const world = createWorld();

    const result = await world.service.updateOpportunityStatus(OPP_ID, 'accepted', USER_A);
    expect('error' in result).toBe(false);

    // resolve never writes over a terminal status the owner just set.
    expect(world.opportunity.status).toBe('accepted');
    expect(world.task.state).toBe('completed');
    expect(await world.negotiationDb.countActiveNegotiationsForRound(INTENT_ID, ROUND)).toBe(0);
    expect(world.reflectJobs).toEqual([{ userId: USER_A, intentId: INTENT_ID, round: ROUND }]);
  });

  it('a match that never negotiated is unaffected', async () => {
    const world = createWorld();
    world.task.state = 'completed';

    const result = await world.service.updateOpportunityStatus(OPP_ID, 'rejected', USER_A);
    expect('error' in result).toBe(false);

    expect(world.opportunity.status).toBe('rejected');
    expect(world.artifacts).toEqual([]);
    expect(world.reflectJobs).toEqual([]);
  });
});
