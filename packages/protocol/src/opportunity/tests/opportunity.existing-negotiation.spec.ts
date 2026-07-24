import { describe, expect, test } from 'bun:test';
import type { Id, Opportunity } from '../../shared/interfaces/database.interface.js';
import { negotiateExistingOpportunity, type ExistingOpportunityNegotiationPort } from '../opportunity.existing-negotiation.js';

describe('negotiateExistingOpportunity', () => {
  test('fails closed before negotiation when a continuation actor binding is stale', async () => {
    const opportunity = {
      id: 'opp-existing',
      actors: [
        { userId: 'recipient' as Id<'users'>, role: 'patient' as const, networkId: 'network-1' as Id<'networks'>, intent: 'intent-recipient' as Id<'intents'> },
        { userId: 'counterparty' as Id<'users'>, role: 'agent' as const, networkId: 'network-1' as Id<'networks'>, intent: 'intent-counterparty' as Id<'intents'> },
      ],
    } as unknown as Opportunity;
    const database = {
      getOpportunity: async () => opportunity,
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
});
