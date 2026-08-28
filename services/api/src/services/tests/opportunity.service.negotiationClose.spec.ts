/**
 * The owner verdict must END the pairing's negotiation (D23).
 *
 * The reflect trigger waits for every task in a bound seat's batch to stop
 * working. Before this fix an ordinary user reject flipped only the opportunity,
 * so its task stayed `working` forever and neither seat's settle was enqueued.
 *
 * The test drives the REAL `NegotiationGraph` over a fake database — the same
 * owner-close lane production runs — rather than asserting that a mock was called, so
 * the count and the enqueue are observed, not stipulated.
 */
/** Config */
import { config } from 'dotenv';
config({ path: '.env.test', override: true });

import { describe, it, expect, mock } from 'bun:test';

import { NegotiationGraphFactory } from '@indexnetwork/protocol';
import type { NegotiationGraphDatabase, NegotiationRoundLogDatabase, NegotiationTaskRow, NegotiationRoundReflectJobData, Opportunity, OpportunityControllerDatabase, OpportunityStatus } from '@indexnetwork/protocol';

import { OpportunityService, type OwnerVerdictNegotiationCloser } from '../opportunity.service';

const USER_A = 'user-a-001';
const USER_B = 'user-b-002';
const OPP_ID = 'opp-negotiated-001';
const INTENT_ID = 'intent-001';
const COUNTERPART_INTENT_ID = 'intent-002';
const NEGOTIATION_ID = 'task-negotiation-001';
const BATCH_ID = 'batch-003';
const COUNTERPART_BATCH_ID = 'batch-passive';

/** One negotiating pairing, shared by both fakes so status writes are observable. */
function negotiatedOpportunity(): Opportunity {
  return {
    id: OPP_ID,
    detection: { source: 'opportunity_graph', timestamp: new Date().toISOString(), triggeredBy: INTENT_ID },
    actors: [
      { networkId: 'idx-1', userId: USER_A, role: 'patient', intent: INTENT_ID },
      { networkId: 'idx-1', userId: USER_B, role: 'agent', intent: COUNTERPART_INTENT_ID },
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
      seats: {
        [INTENT_ID]: { userId: USER_A, batchId: BATCH_ID },
        [COUNTERPART_INTENT_ID]: { userId: USER_B, batchId: COUNTERPART_BATCH_ID },
      },
    },
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

/**
 * The world both the opportunity service and the negotiation graph write into:
 * one opportunity row, one negotiation task, an in-memory round-log (both
 * seats' batches pre-seeded as already opened+opening_complete, matching
 * what a real kickoff would have left behind before this close), plus the
 * reflect enqueue the all-paused check calls.
 */
function createWorld() {
  const opportunity = negotiatedOpportunity();
  const task = negotiationTask();
  const reflectJobs: NegotiationRoundReflectJobData[] = [];
  const artifacts: Array<{ verdict: string; reasoning?: string; resolvedByUserId?: string }> = [];

  type RoundLogEvent = { kind: string; taskId?: string; batchId: string; via?: string; reason?: string; createdAt: Date };
  const roundLogEvents = new Map<string, RoundLogEvent[]>();
  const seed = (intentId: string, batchId: string) => {
    roundLogEvents.set(`${intentId}::${batchId}`, [
      { kind: 'opened', taskId: task.id, batchId, createdAt: new Date() },
      { kind: 'opening_complete', batchId, createdAt: new Date() },
    ]);
  };
  seed(INTENT_ID, BATCH_ID);
  seed(COUNTERPART_INTENT_ID, COUNTERPART_BATCH_ID);
  const roundLog: NegotiationRoundLogDatabase = {
    appendNegotiationRoundLogEvent: async (intentId, event) => {
      const key = `${intentId}::${event.batchId}`;
      const list = roundLogEvents.get(key) ?? [];
      list.push({ ...event, createdAt: new Date() });
      roundLogEvents.set(key, list);
    },
    readNegotiationRoundLogEvents: async (intentId, batchId) =>
      [...(roundLogEvents.get(`${intentId}::${batchId}`) ?? [])] as never,
  };

  const negotiationDb = {
    getOpportunity: async () => opportunity,
    getNegotiationTask: async (id: string) => (id === task.id ? task : null),
    getNegotiationTaskForOpportunity: async (opportunityId: string) =>
      opportunityId === OPP_ID && task.state !== 'completed' ? task : null,
    completeNegotiation: async (input: { verdict: string; reasoning?: string; resolvedByUserId: string }) => {
      if (!['accepted', 'rejected', 'expired'].includes(opportunity.status) || task.state === 'completed') return null;
      artifacts.push({
        verdict: input.verdict,
        reasoning: input.reasoning,
        resolvedByUserId: input.resolvedByUserId,
      });
      task.state = 'completed';
      task.metadata.watchdogReflectPending = true;
      return task;
    },
    clearNegotiationReflectPending: async () => {
      task.metadata.watchdogReflectPending = false;
    },
    updateNegotiationTaskState: async (_taskId: string, state: NegotiationTaskRow['state']) => {
      task.state = state;
      return task;
    },
    countActiveNegotiationsForBatch: async (intentId: string, batchId: string) =>
      task.metadata.seats[intentId]?.batchId === batchId && task.state === 'working' ? 1 : 0,
    getIntentNegotiationBatch: async (intentId: string) => ({
      batchId: task.metadata.seats[intentId]?.batchId ?? null,
    }),
    getNegotiationTasksForIntentBatch: async (intentId: string, batchId: string) =>
      task.metadata.seats[intentId]?.batchId === batchId ? [task] : [],
  } as unknown as NegotiationGraphDatabase;

  const graph = new NegotiationGraphFactory({
    database: negotiationDb,
    roundLog,
    reflectEnqueue: async (job) => {
      reflectJobs.push(job);
    },
  }).createGraph();

  const closer: OwnerVerdictNegotiationCloser = {
    liveNegotiationId: async (opportunityId) =>
      (await negotiationDb.getNegotiationTaskForOpportunity(opportunityId))?.id ?? null,
    close: (input) => graph.invoke({
      negotiationId: input.negotiationId,
      close: { reason: 'owner_verdict', verdict: input.verdict, reasoning: input.reasoning },
      byUserId: input.byUserId,
    }),
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

  const service = new OpportunityService(opportunityDb, undefined, undefined, {}, closer);

  return { opportunity, task, reflectJobs, artifacts, negotiationDb, service };
}

describe('OpportunityService owner verdict closes the negotiation', () => {
  it('a user reject drops the batch to zero active negotiations and enqueues reflect', async () => {
    const world = createWorld();

    // Before: the batch still has one negotiation holding it open.
    expect(await world.negotiationDb.countActiveNegotiationsForBatch(INTENT_ID, BATCH_ID)).toBe(1);

    const result = await world.service.updateOpportunityStatus(OPP_ID, 'rejected', USER_A);
    expect('error' in result).toBe(false);

    expect(world.opportunity.status).toBe('rejected');
    expect(world.task.state).toBe('completed');
    expect(world.task.metadata.watchdogReflectPending).toBe(false);
    expect(await world.negotiationDb.countActiveNegotiationsForBatch(INTENT_ID, BATCH_ID)).toBe(0);
    expect(world.reflectJobs).toEqual([
      { userId: USER_A, intentId: INTENT_ID, batchId: BATCH_ID, dedupeKey: `${NEGOTIATION_ID}.2` },
      { userId: USER_B, intentId: COUNTERPART_INTENT_ID, batchId: COUNTERPART_BATCH_ID, dedupeKey: `${NEGOTIATION_ID}.2` },
    ]);
    expect(world.artifacts).toEqual([
      {
        verdict: 'reject',
        reasoning: 'Closed by the owner declining this match.',
        resolvedByUserId: USER_A,
      },
    ]);
  });

  it('a user accept closes the negotiation without downgrading the accepted opportunity', async () => {
    const world = createWorld();

    const result = await world.service.updateOpportunityStatus(OPP_ID, 'accepted', USER_A);
    expect('error' in result).toBe(false);

    // Owner-close never writes over the terminal status the owner just set.
    expect(world.opportunity.status).toBe('accepted');
    expect(world.task.state).toBe('completed');
    expect(await world.negotiationDb.countActiveNegotiationsForBatch(INTENT_ID, BATCH_ID)).toBe(0);
    expect(world.reflectJobs).toEqual([
      { userId: USER_A, intentId: INTENT_ID, batchId: BATCH_ID, dedupeKey: `${NEGOTIATION_ID}.2` },
      { userId: USER_B, intentId: COUNTERPART_INTENT_ID, batchId: COUNTERPART_BATCH_ID, dedupeKey: `${NEGOTIATION_ID}.2` },
    ]);
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
