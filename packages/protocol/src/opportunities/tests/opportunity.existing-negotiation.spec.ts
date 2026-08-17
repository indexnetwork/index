import { describe, expect, test } from 'bun:test';
import type { ActiveIntent, Id, IntentRecord, Opportunity } from '../../shared/interfaces/database.interface.js';
import { negotiateExistingOpportunity, type ExistingOpportunityNegotiationPort } from '../opportunity.existing-negotiation.js';

const FLAG = 'NEGOTIATION_INCLUDE_OTHER_INTENTS';

async function withFlag(value: string | undefined, run: () => Promise<void>): Promise<void> {
  const previous = process.env[FLAG];
  if (value === undefined) delete process.env[FLAG];
  else process.env[FLAG] = value;
  try {
    await run();
  } finally {
    if (previous === undefined) delete process.env[FLAG];
    else process.env[FLAG] = previous;
  }
}

function opportunity(overrides?: Partial<Opportunity>): Opportunity {
  return {
    id: 'opp-existing',
    actors: [
      { userId: 'recipient' as Id<'users'>, role: 'patient', networkId: 'network-1' as Id<'networks'>, intent: 'intent-recipient' as Id<'intents'> },
      { userId: 'counterparty' as Id<'users'>, role: 'agent', networkId: 'network-1' as Id<'networks'>, intent: 'intent-counterparty' as Id<'intents'> },
    ],
    detection: { source: 'manual', createdBy: 'recipient' as Id<'users'> },
    interpretation: { reasoning: 'Strong fit' },
    context: null,
    confidence: 1,
    status: 'negotiating',
    createdAt: new Date(),
    updatedAt: new Date(),
    expiresAt: null,
    ...overrides,
  };
}

function activeIntent(_userId: string, id: string): ActiveIntent {
  return {
    id: id as Id<'intents'>,
    payload: `Payload for ${id}`,
    summary: `Summary for ${id}`,
    createdAt: new Date(),
  };
}

function exactIntent(userId: string, id: string): IntentRecord {
  return {
    ...activeIntent(userId, id),
    userId,
    isIncognito: false,
    updatedAt: new Date(),
    archivedAt: null,
  };
}

function databaseFor(
  persistedOpportunity: Opportunity,
  options?: {
    activeIntents?: Record<string, ActiveIntent[]>;
    exactIntents?: Record<string, IntentRecord | null>;
    onActiveIntentRead?: (userId: string) => void;
  },
): ExistingOpportunityNegotiationPort {
  return {
    getOpportunity: async () => persistedOpportunity,
    getUser: async (userId) => ({ id: userId, name: userId, email: `${userId}@example.com`, socials: [] }),
    getProfile: async () => null,
    getActiveIntents: async (userId) => {
      options?.onActiveIntentRead?.(userId);
      return options?.activeIntents?.[userId] ?? [];
    },
    getIntent: async (intentId) => options?.exactIntents?.[intentId] ?? null,
    getNetworkMemberContext: async () => null,
  } as ExistingOpportunityNegotiationPort;
}

describe('negotiateExistingOpportunity', () => {
  test('fails closed before negotiation when a continuation actor binding is stale', async () => {
    const persistedOpportunity = opportunity();
    const database = {
      getOpportunity: async () => persistedOpportunity,
    } as unknown as ExistingOpportunityNegotiationPort;
    const executeNegotiation = async () => {
        throw new Error('stale continuation must not invoke negotiation');
      };

    const result = await negotiateExistingOpportunity(
      database,
      executeNegotiation,
      {
        opportunityId: 'opp-existing',
        actorUserId: 'recipient',
        continuation: {
          taskId: 'task-1',
          settlementId: 'settlement-1',
          opportunityId: 'opp-existing',
          userId: 'recipient',
          recipientIntentId: 'intent-recipient',
          networkId: 'network-1',
          intentFingerprint: 'fingerprint',
          opportunityStatus: 'negotiating',
          opportunityUpdatedAt: new Date().toISOString(),
          counterpartyUserId: 'counterparty',
          counterpartyIntentId: 'different-intent',
          successorTaskId: 'task-2',
          conversationId: 'conversation-1',
          token: 'token',
          fence: 1,
          leaseExpiresAt: new Date().toISOString(),
          consultation: { recipientUserId: 'recipient', recipientIntentId: 'intent-recipient', kind: 'answer', selectedOptions: [] },
        },
      },
    );

    expect(result).toEqual({ kind: 'skipped', reason: 'stale_continuation' });
  });

  test('unset flag preserves exact-first unrelated active-intent fallback for both sides', async () => {
    await withFlag(undefined, async () => {
      const captured: Array<{ source: string[]; candidate: string[] }> = [];
      const database = databaseFor(opportunity(), {
        activeIntents: {
          recipient: [
            activeIntent('recipient', 'other-recipient'),
            activeIntent('recipient', 'intent-recipient'),
          ],
          counterparty: [
            activeIntent('counterparty', 'other-counterparty'),
            activeIntent('counterparty', 'intent-counterparty'),
          ],
        },
      });

      await negotiateExistingOpportunity(
        database,
        async ({ sourceUser, candidate }) => {
          captured.push({
            source: sourceUser.intents.map((intent) => intent.id),
            candidate: candidate.candidateUser.intents.map((intent) => intent.id),
          });
          return { accepted: false };
        },
        { opportunityId: 'opp-existing', actorUserId: 'recipient' },
      );

      expect(captured).toEqual([{
        source: ['intent-recipient', 'other-recipient'],
        candidate: ['intent-counterparty', 'other-counterparty'],
      }]);
    });
  });

  test('false flag isolates both sides on an exact continuation and skips unrelated active-intent reads', async () => {
    await withFlag('false', async () => {
      const activeIntentReads: string[] = [];
      const captured: Array<{ source: string[]; candidate: string[] }> = [];
      const database = databaseFor(opportunity(), {
        exactIntents: {
          'intent-recipient': exactIntent('recipient', 'intent-recipient'),
          'intent-counterparty': exactIntent('counterparty', 'intent-counterparty'),
        },
        onActiveIntentRead: (userId) => activeIntentReads.push(userId),
      });

      await negotiateExistingOpportunity(
        database,
        async ({ sourceUser, candidate, continuation }) => {
          expect(continuation?.taskId).toBe('task-1');
          captured.push({
            source: sourceUser.intents.map((intent) => intent.id),
            candidate: candidate.candidateUser.intents.map((intent) => intent.id),
          });
          return { accepted: false };
        },
        {
          opportunityId: 'opp-existing',
          actorUserId: 'recipient',
          continuation: {
            taskId: 'task-1',
            settlementId: 'settlement-1',
            opportunityId: 'opp-existing',
            userId: 'recipient',
            recipientIntentId: 'intent-recipient',
            networkId: 'network-1',
            intentFingerprint: 'fingerprint',
            opportunityStatus: 'negotiating',
            opportunityUpdatedAt: new Date().toISOString(),
            counterpartyUserId: 'counterparty',
            counterpartyIntentId: 'intent-counterparty',
            successorTaskId: 'task-2',
            conversationId: 'conversation-1',
            token: 'token',
            fence: 1,
            leaseExpiresAt: new Date().toISOString(),
            consultation: { recipientUserId: 'recipient', recipientIntentId: 'intent-recipient', kind: 'answer', selectedOptions: [] },
          },
        },
      );

      expect(activeIntentReads).toEqual([]);
      expect(captured).toEqual([{
        source: ['intent-recipient'],
        candidate: ['intent-counterparty'],
      }]);
    });
  });

  test('false flag sends no unrelated fallback for an actor with no exact opportunity-bound intent', async () => {
    await withFlag('false', async () => {
      const captured: Array<{ source: string[]; candidate: string[] }> = [];
      const persistedOpportunity = opportunity({
        actors: [
          { userId: 'recipient' as Id<'users'>, role: 'patient', networkId: 'network-1' as Id<'networks'> },
          { userId: 'counterparty' as Id<'users'>, role: 'agent', networkId: 'network-1' as Id<'networks'>, intent: 'intent-counterparty' as Id<'intents'> },
        ],
      });
      const database = databaseFor(persistedOpportunity, {
        activeIntents: {
          recipient: [activeIntent('recipient', 'unrelated-recipient')],
          counterparty: [activeIntent('counterparty', 'unrelated-counterparty')],
        },
        exactIntents: {
          'intent-counterparty': exactIntent('counterparty', 'intent-counterparty'),
        },
      });

      await negotiateExistingOpportunity(
        database,
        async ({ sourceUser, candidate }) => {
          captured.push({
            source: sourceUser.intents.map((intent) => intent.id),
            candidate: candidate.candidateUser.intents.map((intent) => intent.id),
          });
          return { accepted: false };
        },
        { opportunityId: 'opp-existing', actorUserId: 'recipient' },
      );

      expect(captured).toEqual([{
        source: [],
        candidate: ['intent-counterparty'],
      }]);
    });
  });
});
