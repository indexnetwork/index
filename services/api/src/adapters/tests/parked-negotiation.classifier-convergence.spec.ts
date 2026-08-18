/**
 * Convergence contract between the parked-set reader and the protocol's
 * canonical park classifier (conversational-questions answer wiring).
 *
 * The reader (`parked-negotiation.reader.adapter.ts`) mirrors
 * `classifyParkedNegotiation`'s semantics set-wise in SQL because adapters may
 * not import `@indexnetwork/protocol` — the layering rule stands, so the two
 * predicates are duplicated by design. This spec is what keeps them honest:
 * both run over the SAME persisted fixtures — mid-flight consult, post-stall
 * park, a park awaiting the counterparty, and a terminal stall without a
 * gap — and must agree on which negotiations are answerable by which user.
 * A drift in either predicate (including the duplicated
 * NEGOTIATION_PARK_REASONING literal) fails here before it can misroute an
 * answer or render a stale question.
 */
import { afterAll, describe, expect, setDefaultTimeout, test } from 'bun:test';
import { randomUUID } from 'crypto';
import { eq, inArray } from 'drizzle-orm';

import { classifyParkedNegotiation, negotiationQuestionSettlementId } from '@indexnetwork/protocol';

import db from '../../lib/drizzle/drizzle';
import { chatDatabaseAdapter } from '../database.adapter';
import { ConversationDatabaseAdapter } from '../conversation.database.adapter';
import { NEGOTIATION_PARK_REASONING, ParkedNegotiationReaderAdapter } from '../parked-negotiation.reader.adapter';
import { intents, networks, networkMembers, opportunities, users } from '../../schemas/database.schema';
import { conversations, messages, tasks } from '../../schemas/conversation.schema';

setDefaultTimeout(30_000);

const conversationAdapter = new ConversationDatabaseAdapter();
const reader = new ParkedNegotiationReaderAdapter();

const cleanup = {
  users: [] as string[],
  networks: [] as string[],
  intents: [] as string[],
  opportunities: [] as string[],
  conversations: [] as string[],
};

afterAll(async () => {
  if (cleanup.conversations.length > 0) {
    const taskRows = await db.select({ id: tasks.id }).from(tasks)
      .where(inArray(tasks.conversationId, cleanup.conversations));
    if (taskRows.length > 0) {
      await db.delete(messages).where(inArray(messages.taskId, taskRows.map((t) => t.id)));
    }
    await db.delete(messages).where(inArray(messages.conversationId, cleanup.conversations));
    await db.delete(tasks).where(inArray(tasks.conversationId, cleanup.conversations));
    await db.delete(conversations).where(inArray(conversations.id, cleanup.conversations));
  }
  if (cleanup.opportunities.length > 0) await db.delete(opportunities).where(inArray(opportunities.id, cleanup.opportunities));
  if (cleanup.intents.length > 0) await db.delete(intents).where(inArray(intents.id, cleanup.intents));
  if (cleanup.networks.length > 0) {
    await db.delete(networkMembers).where(inArray(networkMembers.networkId, cleanup.networks));
    await db.delete(networks).where(inArray(networks.id, cleanup.networks));
  }
  if (cleanup.users.length > 0) await db.delete(users).where(inArray(users.id, cleanup.users));
});

interface Fixture {
  ownerId: string;
  counterpartyId: string;
  ownerIntentId: string;
  counterpartyIntentId: string;
  networkId: string;
}

async function seedParticipants(): Promise<Fixture> {
  const [owner, counterparty] = await db.insert(users).values([
    { email: `convergence-owner-${randomUUID()}@test.local`, name: 'Convergence owner' },
    { email: `convergence-counterparty-${randomUUID()}@test.local`, name: 'Convergence counterparty' },
  ]).returning({ id: users.id });
  cleanup.users.push(owner.id, counterparty.id);
  const [network] = await db.insert(networks).values({
    title: `Convergence ${randomUUID()}`,
    description: 'classifier convergence fixture',
    isPersonal: false,
  }).returning({ id: networks.id });
  cleanup.networks.push(network.id);
  await db.insert(networkMembers).values([
    { networkId: network.id, userId: owner.id, permissions: ['member'] },
    { networkId: network.id, userId: counterparty.id, permissions: ['member'] },
  ]);
  const [ownerIntent] = await db.insert(intents).values({
    userId: owner.id, payload: 'Find a collaborator', status: 'ACTIVE',
  }).returning({ id: intents.id });
  const [counterpartyIntent] = await db.insert(intents).values({
    userId: counterparty.id, payload: 'Offer collaboration', status: 'ACTIVE',
  }).returning({ id: intents.id });
  cleanup.intents.push(ownerIntent.id, counterpartyIntent.id);
  return {
    ownerId: owner.id,
    counterpartyId: counterparty.id,
    ownerIntentId: ownerIntent.id,
    counterpartyIntentId: counterpartyIntent.id,
    networkId: network.id,
  };
}

async function seedNegotiation(
  fixture: Fixture,
  opportunityStatus: 'negotiating' | 'stalled',
): Promise<{ opportunityId: string; taskId: string; conversationId: string }> {
  const [opportunity] = await db.insert(opportunities).values({
    detection: { kind: 'test', summary: 'classifier convergence' } as never,
    actors: [
      { userId: fixture.counterpartyId, intent: fixture.counterpartyIntentId, networkId: fixture.networkId, role: 'peer' },
      { userId: fixture.ownerId, intent: fixture.ownerIntentId, networkId: fixture.networkId, role: 'peer' },
    ] as never,
    interpretation: { reasoning: 'fixture', category: 'test' } as never,
    context: { networkId: fixture.networkId } as never,
    confidence: '0.9',
    status: opportunityStatus,
  }).returning({ id: opportunities.id });
  cleanup.opportunities.push(opportunity.id);
  const conversation = await conversationAdapter.createConversation([
    { participantId: `agent:${fixture.ownerId}`, participantType: 'agent' },
    { participantId: `agent:${fixture.counterpartyId}`, participantType: 'agent' },
  ]);
  cleanup.conversations.push(conversation.id);
  const task = await conversationAdapter.createTask(conversation.id, {
    type: 'negotiation',
    opportunityId: opportunity.id,
    networkId: fixture.networkId,
    sourceUserId: fixture.ownerId,
    candidateUserId: fixture.counterpartyId,
    sourceIntentId: fixture.ownerIntentId,
    candidateIntentId: fixture.counterpartyIntentId,
    participantBindings: [
      { userId: fixture.ownerId, intentId: fixture.ownerIntentId, networkId: fixture.networkId },
      { userId: fixture.counterpartyId, intentId: fixture.counterpartyIntentId, networkId: fixture.networkId },
    ],
  });
  return { opportunityId: opportunity.id, taskId: task.id, conversationId: conversation.id };
}

function parkTurn() {
  return {
    action: 'ask_user',
    message: null,
    assessment: {
      reasoning: NEGOTIATION_PARK_REASONING,
      suggestedRoles: { ownUser: 'peer', otherUser: 'peer' },
    },
    askUser: {
      reason: 'unresolved_owner_constraint',
      question: {
        title: 'Timing',
        prompt: 'When can you start?',
        options: [
          { label: 'Now', description: 'Immediately.' },
          { label: 'Later', description: 'In a few months.' },
        ],
      },
    },
  };
}

function ordinaryTurn() {
  return {
    action: 'counter',
    message: 'Counter terms.',
    assessment: { reasoning: 'ordinary turn', suggestedRoles: { ownUser: 'peer', otherUser: 'peer' } },
  };
}

async function appendTurn(conversationId: string, taskId: string, senderId: string, turn: unknown): Promise<void> {
  await conversationAdapter.createMessage({
    conversationId,
    taskId,
    senderId,
    role: 'agent',
    parts: [{ kind: 'data', data: turn }],
  });
}

describe('parked-set reader ⇄ classifyParkedNegotiation convergence', () => {
  test('mid-flight consult: classifier says inflight, reader includes it as mid_flight', async () => {
    const fixture = await seedParticipants();
    const negotiation = await seedNegotiation(fixture, 'negotiating');
    await appendTurn(negotiation.conversationId, negotiation.taskId, `agent:${fixture.counterpartyId}`, ordinaryTurn());
    await db.update(tasks).set({
      state: 'input_required',
      metadata: (await db.select({ metadata: tasks.metadata }).from(tasks).where(eq(tasks.id, negotiation.taskId)))
        .map((row) => ({
          ...(row.metadata as Record<string, unknown>),
          turnContext: {
            askUserBinding: {
              version: 2,
              settlementId: negotiationQuestionSettlementId(negotiation.taskId),
              recipientUserId: fixture.ownerId,
              recipientIntentId: fixture.ownerIntentId,
              opportunityId: negotiation.opportunityId,
              networkId: fixture.networkId,
              intentFingerprint: 'fixture-fingerprint',
              opportunityStatus: 'negotiating',
              opportunityUpdatedAt: new Date().toISOString(),
              counterpartyUserId: fixture.counterpartyId,
              counterpartyIntentId: fixture.counterpartyIntentId,
            },
          },
        }))[0],
    }).where(eq(tasks.id, negotiation.taskId));

    const classification = await classifyParkedNegotiation(chatDatabaseAdapter, {
      opportunityId: negotiation.opportunityId,
      userId: fixture.ownerId,
    });
    const parkedSet = await reader.readParkedNegotiations(fixture.ownerId, fixture.ownerIntentId);
    const entry = parkedSet.find((parked) => parked.opportunityId === negotiation.opportunityId);

    expect(classification.kind).toBe('inflight');
    expect(entry?.kind).toBe('mid_flight');

    // The counterparty must see it through NEITHER predicate.
    const counterpartyClassification = await classifyParkedNegotiation(chatDatabaseAdapter, {
      opportunityId: negotiation.opportunityId,
      userId: fixture.counterpartyId,
    });
    const counterpartySet = await reader.readParkedNegotiations(fixture.counterpartyId, fixture.counterpartyIntentId);
    expect(counterpartyClassification.kind).toBe('wrong_recipient');
    expect(counterpartySet.some((parked) => parked.opportunityId === negotiation.opportunityId)).toBe(false);
  });

  test('post-stall park: classifier says post_stall, reader includes it as post_stall', async () => {
    const fixture = await seedParticipants();
    const negotiation = await seedNegotiation(fixture, 'stalled');
    await appendTurn(negotiation.conversationId, negotiation.taskId, `agent:${fixture.counterpartyId}`, ordinaryTurn());
    await appendTurn(negotiation.conversationId, negotiation.taskId, `agent:${fixture.ownerId}`, parkTurn());
    await db.update(tasks).set({ state: 'completed' }).where(eq(tasks.id, negotiation.taskId));

    const classification = await classifyParkedNegotiation(chatDatabaseAdapter, {
      opportunityId: negotiation.opportunityId,
      userId: fixture.ownerId,
    });
    const parkedSet = await reader.readParkedNegotiations(fixture.ownerId, fixture.ownerIntentId);
    const entry = parkedSet.find((parked) => parked.opportunityId === negotiation.opportunityId);

    expect(classification.kind).toBe('post_stall');
    expect(entry?.kind).toBe('post_stall');
    // The park-time question survives into the reader's rendering payload.
    expect(entry?.question?.prompt).toBe('When can you start?');
  });

  test('park awaiting the counterparty: classifier refuses this user, reader scopes it to the other side', async () => {
    const fixture = await seedParticipants();
    const negotiation = await seedNegotiation(fixture, 'stalled');
    await appendTurn(negotiation.conversationId, negotiation.taskId, `agent:${fixture.ownerId}`, ordinaryTurn());
    // The gap needs the COUNTERPARTY's client, not the owner's.
    await appendTurn(negotiation.conversationId, negotiation.taskId, `agent:${fixture.counterpartyId}`, parkTurn());
    await db.update(tasks).set({ state: 'completed' }).where(eq(tasks.id, negotiation.taskId));

    const ownerClassification = await classifyParkedNegotiation(chatDatabaseAdapter, {
      opportunityId: negotiation.opportunityId,
      userId: fixture.ownerId,
    });
    const ownerSet = await reader.readParkedNegotiations(fixture.ownerId, fixture.ownerIntentId);
    expect(ownerClassification.kind).toBe('wrong_recipient');
    expect(ownerSet.some((parked) => parked.opportunityId === negotiation.opportunityId)).toBe(false);

    const counterpartyClassification = await classifyParkedNegotiation(chatDatabaseAdapter, {
      opportunityId: negotiation.opportunityId,
      userId: fixture.counterpartyId,
    });
    const counterpartySet = await reader.readParkedNegotiations(fixture.counterpartyId, fixture.counterpartyIntentId);
    expect(counterpartyClassification.kind).toBe('post_stall');
    expect(counterpartySet.find((parked) => parked.opportunityId === negotiation.opportunityId)?.kind).toBe('post_stall');
  });

  test('terminal stall without a gap: classifier says not_parked, reader excludes it', async () => {
    const fixture = await seedParticipants();
    const negotiation = await seedNegotiation(fixture, 'stalled');
    await appendTurn(negotiation.conversationId, negotiation.taskId, `agent:${fixture.counterpartyId}`, ordinaryTurn());
    await appendTurn(negotiation.conversationId, negotiation.taskId, `agent:${fixture.ownerId}`, ordinaryTurn());
    await db.update(tasks).set({ state: 'completed' }).where(eq(tasks.id, negotiation.taskId));

    const classification = await classifyParkedNegotiation(chatDatabaseAdapter, {
      opportunityId: negotiation.opportunityId,
      userId: fixture.ownerId,
    });
    const parkedSet = await reader.readParkedNegotiations(fixture.ownerId, fixture.ownerIntentId);

    expect(classification.kind).toBe('not_parked');
    expect(parkedSet.some((parked) => parked.opportunityId === negotiation.opportunityId)).toBe(false);
  });
});
