import { config } from 'dotenv';
config({ path: '.env.test', override: true });

import { describe, it, expect } from 'bun:test';
import { selectByComposition } from '@indexnetwork/protocol';

describe('selectByComposition', () => {
  const viewerId = 'user-1';

  function makeOpp(id: string, isConnectorFlow: boolean, status = 'pending') {
    if (isConnectorFlow) {
      // Viewer is the introducer — classifyOpportunity checks viewerId role
      return {
        id,
        actors: [
          { userId: viewerId, role: 'introducer' },
          { userId: `party-a-${id}`, role: 'party' },
          { userId: `party-b-${id}`, role: 'party' },
        ],
        status,
      };
    }
    return {
      id,
      actors: [
        { userId: viewerId, role: 'party' },
        { userId: `other-${id}`, role: 'party' },
      ],
      status,
    };
  }

  it('fills soft targets when enough items exist', () => {
    const opps = [
      ...Array.from({ length: 5 }, (_, i) => makeOpp(`conn-${i}`, false)),
      ...Array.from({ length: 4 }, (_, i) => makeOpp(`cf-${i}`, true)),
      ...Array.from({ length: 3 }, (_, i) => makeOpp(`exp-${i}`, false, 'expired')),
    ];
    const result = selectByComposition(opps, viewerId);
    const connections = result.filter((o) => o.status !== 'expired' && !o.actors.some((a) => a.role === 'introducer'));
    const connectorFlows = result.filter((o) => o.status !== 'expired' && o.actors.some((a) => a.role === 'introducer'));
    const expired = result.filter((o) => o.status === 'expired');
    expect(connections.length).toBe(3);
    expect(connectorFlows.length).toBe(2);
    expect(expired.length).toBe(2);
  });

  it('redistributes slots when a category is underrepresented', () => {
    const opps = [
      ...Array.from({ length: 5 }, (_, i) => makeOpp(`conn-${i}`, false)),
      makeOpp('cf-0', true),
    ];
    const result = selectByComposition(opps, viewerId);
    // 1 connector-flow (under target of 2), extra slot goes to connections
    const connections = result.filter((o) => !o.actors.some((a) => a.role === 'introducer'));
    expect(connections.length).toBeGreaterThan(3);
  });

  it('returns all items when fewer than total soft target', () => {
    const opps = [makeOpp('conn-0', false), makeOpp('cf-0', true)];
    const result = selectByComposition(opps, viewerId);
    expect(result.length).toBe(2);
  });

  it('preserves input order within each category', () => {
    const opps = [
      makeOpp('conn-0', false),
      makeOpp('conn-1', false),
      makeOpp('conn-2', false),
      makeOpp('conn-3', false),
    ];
    const result = selectByComposition(opps, viewerId);
    const ids = result.map((o) => o.id);
    expect(ids[0]).toBe('conn-0');
    expect(ids[1]).toBe('conn-1');
    expect(ids[2]).toBe('conn-2');
  });
});
