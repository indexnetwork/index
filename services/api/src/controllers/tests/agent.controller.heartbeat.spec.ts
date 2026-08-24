import { describe, expect, it } from 'bun:test';

import { parseFiniteLimit, pickupOpportunityAtControllerBoundary, pickupTestMessageAtControllerBoundary } from '../../lib/agent/negotiation-controller-boundary';

const AGENT_ID = 'agent-123';
const OWNER_ID = 'user-456';

// The hermetic negotiation-pickup controller seam (`pickupNegotiationAtControllerBoundary`)
// was retired whole-cloth by the negotiation-graph rewrite (#1494,
// docs/plans/2026-08-23-personal-agent-and-negotiation-graphs.md): a
// negotiation can no longer be claimed under the new working-only lifecycle,
// so the pickup route — and this seam behind it — is deleted.

describe('hermetic non-negotiation pickup seams', () => {
  it('authorizes test-message pickup before work and touches lastSeen only afterward', async () => {
    const order: string[] = [];
    const result = await pickupTestMessageAtControllerBoundary({
      agentId: AGENT_ID,
      ownerId: OWNER_ID,
      authorize: async () => { order.push('authorize'); },
      pickup: async () => { order.push('pickup'); return null; },
      touchLastSeen: async () => { order.push('touch'); },
    });

    expect(result).toBeNull();
    expect(order).toEqual(['authorize', 'pickup', 'touch']);
  });

  it('does not spoof test-message liveness when ownership authorization fails', async () => {
    const order: string[] = [];
    const operation = pickupTestMessageAtControllerBoundary({
      agentId: AGENT_ID,
      ownerId: OWNER_ID,
      authorize: async () => { order.push('authorize'); throw new Error('Not authorized'); },
      pickup: async () => { order.push('pickup'); return null; },
      touchLastSeen: async () => { order.push('touch'); },
    });

    await expect(operation).rejects.toThrow('Not authorized');
    expect(order).toEqual(['authorize']);
  });

  it('authorizes opportunity pickup, touches lastSeen, then reserves work', async () => {
    const order: string[] = [];
    const result = await pickupOpportunityAtControllerBoundary({
      agentId: AGENT_ID,
      ownerId: OWNER_ID,
      authorize: async () => { order.push('authorize'); },
      touchLastSeen: async () => { order.push('touch'); },
      pickup: async () => { order.push('pickup'); return null; },
    });

    expect(result).toBeNull();
    expect(order).toEqual(['authorize', 'touch', 'pickup']);
  });
});

describe('hermetic pending-opportunity limit parsing', () => {
  it.each<[string, number]>([
    ['7', 7], ['1', 1], ['20', 20], ['21', 21],
    ['0', 0], ['-3', -3], ['1.5', 1.5],
  ])('accepts finite ?limit=%s for downstream normalization', (param, expected) => {
    expect(parseFiniteLimit(`http://localhost/pending?limit=${param}`))
      .toEqual({ kind: 'valid', value: expected });
  });

  it.each([
    'http://localhost/pending',
    'http://localhost/pending?limit=',
  ])('maps absent or empty limits to undefined', (url) => {
    expect(parseFiniteLimit(url)).toEqual({ kind: 'valid', value: undefined });
  });

  it.each(['abc', 'Infinity', '-Infinity', 'NaN'])(
    'rejects non-finite ?limit=%s',
    (param) => {
      expect(parseFiniteLimit(`http://localhost/pending?limit=${param}`))
        .toEqual({ kind: 'invalid' });
    },
  );
});
