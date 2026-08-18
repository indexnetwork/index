import { describe, expect, test } from 'bun:test';

import type { OpportunityRow, UserIdentity } from '../../adapters/database.shared';
import type { NotificationStreamEvent } from '../../lib/notification-stream-events';
import { NotificationDeliveryService } from '../notification-delivery.service';

const now = new Date('2026-08-10T12:00:00.000Z');

function identity(userId: string, name: string): UserIdentity {
  return {
    userId,
    identity: { name, bio: '', location: '' },
    context: '',
  };
}

function opportunity(input: {
  id: string;
  actors: OpportunityRow['actors'];
  status?: OpportunityRow['status'];
  reasoning?: string;
}): OpportunityRow {
  return {
    id: input.id,
    detection: { source: 'opportunity_graph', timestamp: now.toISOString() },
    actors: input.actors,
    interpretation: {
      category: 'Internal evaluator category',
      reasoning: input.reasoning ?? 'Casey builds privacy-preserving collaboration tools.',
      confidence: 0.9,
    },
    context: { networkId: 'network-1' },
    confidence: '0.9',
    status: input.status ?? 'pending',
    createdAt: now,
    updatedAt: now,
    expiresAt: null,
    metadata: {},
  };
}


function sortEvents(events: NotificationStreamEvent[]): NotificationStreamEvent[] {
  return [...events].sort((left, right) => `${left.type}:${left.id}`.localeCompare(`${right.type}:${right.id}`));
}

describe('NotificationDeliveryService persisted projection', () => {
  test('realtime and snapshot return identical safe copy and exclude pending opportunities the user acted on', async () => {
    const actionableOpportunity = opportunity({
      id: 'opportunity-actionable',
      actors: [
        { userId: 'viewer', networkId: 'network-1', role: 'patient' },
        { userId: 'peer', networkId: 'network-1', role: 'agent' },
      ],
      reasoning: 'Casey builds privacy tools. You both attended the same event according to internal scoring.',
    });
    const actedOpportunity = opportunity({
      id: 'opportunity-acted',
      actors: [
        { userId: 'viewer', networkId: 'network-1', role: 'patient', actedAt: now.toISOString() },
        { userId: 'other-peer', networkId: 'network-1', role: 'agent' },
      ],
    });
    const opportunitiesById = new Map([
      [actionableOpportunity.id, actionableOpportunity],
      [actedOpportunity.id, actedOpportunity],
    ]);
    const identities = new Map([
      ['viewer', identity('viewer', 'Viewer Name')],
      ['peer', identity('peer', 'Casey Counterpart')],
      ['other-peer', identity('other-peer', 'Other Peer')],
    ]);
    const published: Array<{ userId: string; event: NotificationStreamEvent }> = [];
    const service = new NotificationDeliveryService({
      opportunities: {
        getOpportunity: async (id) => opportunitiesById.get(id) ?? null,
        getNotificationSnapshotOpportunities: async (userId) => userId === 'viewer'
          ? [actionableOpportunity, actedOpportunity]
          : [],
      },
      getIdentity: async (userId) => identities.get(userId) ?? null,
      getIntentLabel: async (intentId) => intentId === 'intent-1' ? 'privacy collaboration' : undefined,
      publish: async (userId, event) => { published.push({ userId, event }); },
    });

    await service.publishOpportunityActionable({ opportunity: { id: actionableOpportunity.id, status: 'pending' } });
    await service.publishOpportunityActionable({ opportunity: { id: actedOpportunity.id, status: 'pending' } });

    const realtimeForViewer = published
      .filter(({ userId }) => userId === 'viewer')
      .map(({ event }) => event);
    const snapshot = await service.snapshot('viewer');

    expect(sortEvents(snapshot)).toEqual(sortEvents(realtimeForViewer));
    expect(snapshot.map(({ id }) => id)).toEqual(['opportunity-actionable']);
    expect(snapshot.find(({ id }) => id === actionableOpportunity.id)?.body).not.toContain('internal scoring');
  });

  test('snapshot preserves realtime parity for actionable roles omitted by the legacy UI query', async () => {
    const legacyOmitted = [
      opportunity({
        id: 'latent-no-introducer-agent',
        status: 'latent',
        actors: [
          { userId: 'viewer', networkId: 'network-1', role: 'agent' },
          { userId: 'patient-peer', networkId: 'network-1', role: 'patient' },
        ],
      }),
      opportunity({
        id: 'latent-approved-introducer-patient',
        status: 'latent',
        actors: [
          { userId: 'viewer', networkId: 'network-1', role: 'patient' },
          { userId: 'agent-peer', networkId: 'network-1', role: 'agent' },
          { userId: 'introducer', networkId: 'network-1', role: 'introducer', approved: true },
        ],
      }),
      opportunity({
        id: 'pending-introducer-agent',
        status: 'pending',
        actors: [
          { userId: 'viewer', networkId: 'network-1', role: 'agent' },
          { userId: 'patient-peer', networkId: 'network-1', role: 'patient' },
          { userId: 'introducer', networkId: 'network-1', role: 'introducer', approved: true },
        ],
      }),
    ];
    const byId = new Map(legacyOmitted.map((row) => [row.id, row]));
    const identities = new Map([
      ['viewer', identity('viewer', 'Viewer')],
      ['patient-peer', identity('patient-peer', 'Patient Peer')],
      ['agent-peer', identity('agent-peer', 'Agent Peer')],
      ['introducer', identity('introducer', 'Introducer')],
    ]);
    const published: Array<{ userId: string; event: NotificationStreamEvent }> = [];
    const service = new NotificationDeliveryService({
      opportunities: {
        getOpportunity: async (id) => byId.get(id) ?? null,
        getNotificationSnapshotOpportunities: async () => legacyOmitted,
      },
      getIdentity: async (userId) => identities.get(userId) ?? null,
      getIntentLabel: async () => undefined,
      publish: async (userId, event) => { published.push({ userId, event }); },
    });

    for (const row of legacyOmitted) {
      await service.publishOpportunityActionable({ opportunity: { id: row.id, status: row.status } });
    }

    const realtimeForViewer = published
      .filter(({ userId }) => userId === 'viewer')
      .map(({ event }) => event);
    const snapshot = await service.snapshot('viewer');

    expect(snapshot.map(({ id }) => id)).toEqual([
      'latent-no-introducer-agent',
      'latent-approved-introducer-patient',
      'pending-introducer-agent',
    ]);
    expect(sortEvents(snapshot)).toEqual(sortEvents(realtimeForViewer));
  });

  test('logs and swallows publish failures at lifecycle boundaries', async () => {
    const failingOpportunity = opportunity({
      id: 'opportunity-failure',
      actors: [
        { userId: 'viewer', networkId: 'network-1', role: 'patient' },
        { userId: 'peer', networkId: 'network-1', role: 'agent' },
      ],
    });
    const service = new NotificationDeliveryService({
      opportunities: {
        getOpportunity: async () => failingOpportunity,
        getNotificationSnapshotOpportunities: async () => [],
      },
      getIdentity: async () => null,
      getIntentLabel: async () => undefined,
      publish: async () => { throw new Error('publisher unavailable'); },
    });

    await expect(service.publishOpportunityActionable({
      opportunity: { id: failingOpportunity.id, status: 'pending' },
    })).resolves.toBeUndefined();
  });
});
