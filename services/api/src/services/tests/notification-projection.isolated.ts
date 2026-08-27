import { describe, expect, test } from 'bun:test';

import type { OpportunityRow, UserIdentity } from '../../adapters/database.shared';
import { actionableRecipientIds, buildOpportunityNotificationEvent, counterpartForRecipient } from '../notification-projection';

const now = new Date('2026-08-10T12:00:00.000Z');

function opportunity(
  status: OpportunityRow['status'],
  actors: OpportunityRow['actors'],
  reasoning = 'Casey builds privacy-preserving collaboration tools.',
): OpportunityRow {
  return {
    id: `opportunity-${status}`,
    detection: {
      source: 'opportunity_graph',
      timestamp: now.toISOString(),
    },
    actors,
    interpretation: {
      category: 'Internal evaluator category',
      reasoning,
      confidence: 0.91,
    },
    context: { networkId: 'network-1' },
    confidence: '0.91',
    status,
    createdAt: now,
    updatedAt: now,
    expiresAt: null,
    metadata: {},
  };
}

function identity(userId: string, name: string): UserIdentity {
  return {
    userId,
    identity: { name, bio: '', location: '' },
    context: '',
  };
}

describe('authoritative opportunity notification projection', () => {
  test('pending opportunities exclude recipients who already acted, including duplicate actor rows', () => {
    const pendingWithActedViewer = opportunity('pending', [
      { userId: 'acted-user', networkId: 'network-1', role: 'patient', actedAt: now.toISOString() },
      { userId: 'acted-user', networkId: 'network-1', role: 'peer' },
      { userId: 'waiting-user', networkId: 'network-1', role: 'agent' },
    ]);

    expect(actionableRecipientIds(pendingWithActedViewer)).not.toContain('acted-user');
    expect(actionableRecipientIds(pendingWithActedViewer)).toEqual(['waiting-user']);
  });

  test('terminal and internal opportunity states have no actionable recipients', () => {
    const actors = [
      { userId: 'viewer', networkId: 'network-1', role: 'patient' },
      { userId: 'peer', networkId: 'network-1', role: 'agent' },
    ];

    for (const status of ['draft', 'negotiating', 'stalled', 'accepted', 'rejected', 'expired'] as const) {
      expect(actionableRecipientIds(opportunity(status, actors))).toEqual([]);
    }
  });

  test('notification copy uses the fixed headline, identity names, and sanitized reasoning', () => {
    const row = opportunity(
      'pending',
      [
        { userId: 'viewer', networkId: 'network-1', role: 'patient' },
        { userId: 'introducer', networkId: 'network-1', role: 'introducer', approved: true },
        { userId: 'peer', networkId: 'network-1', role: 'agent' },
      ],
      'Casey builds privacy-preserving tools. You both attended the same event according to internal scoring.',
    );

    const event = buildOpportunityNotificationEvent(row, {
      viewer: identity('viewer', 'Viewer Name'),
      counterpart: identity('peer', 'Casey Counterpart'),
      introducer: identity('introducer', 'Ivy Introducer'),
    });

    expect(event.headline).toBe('A promising connection');
    expect(event.counterpartyName).toBe('Casey Counterpart');
    expect(event.summary).toContain('Casey builds privacy-preserving tools.');
    expect(event.summary).not.toContain('internal scoring');
    expect(event.summary).not.toContain('Ivy Introducer');
  });
});
