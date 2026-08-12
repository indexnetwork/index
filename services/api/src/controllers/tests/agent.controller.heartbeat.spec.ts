import { beforeEach, describe, expect, it, mock } from 'bun:test';

import { parseFiniteLimit, pickupNegotiationAtControllerBoundary, pickupOpportunityAtControllerBoundary, pickupTestMessageAtControllerBoundary } from '../../lib/agent/negotiation-controller-boundary';
import { recordRequestAuthContext } from '../../lib/request-auth-context';

const AGENT_ID = 'agent-123';
const OWNER_ID = 'user-456';
const RESULT = { taskId: 'task-1' };
const callOrder: string[] = [];

const resolveAgentPrincipal = mock(async (_request: Request): Promise<string | null> => {
  callOrder.push('authorize');
  return AGENT_ID;
});
const pickup = mock(async () => {
  callOrder.push('pickup-transaction');
  return RESULT;
});
// This intentionally exists only as a canary. The hermetic production seam has
// no way to receive or call an out-of-transaction heartbeat dependency.
const touchNegotiationPickup = mock(async () => {
  callOrder.push('controller-heartbeat');
});

function request(context: {
  kind: 'api_key';
  agentId: string | null;
  credentialId?: string | null;
  audience?: 'hermes-negotiator' | null;
  setupAttemptId?: string | null;
} = {
  kind: 'api_key',
  agentId: AGENT_ID,
  credentialId: 'credential-current',
  audience: 'hermes-negotiator',
  setupAttemptId: 'setup-current',
}): Request {
  const value = new Request(`http://localhost/agents/${AGENT_ID}/negotiations/pickup`, {
    method: 'POST',
    headers: context.audience === 'hermes-negotiator'
      ? { 'x-index-hermes-run-id': 'run-provider-free' }
      : undefined,
  });
  recordRequestAuthContext(value, context);
  return value;
}

beforeEach(() => {
  callOrder.length = 0;
  resolveAgentPrincipal.mockClear();
  resolveAgentPrincipal.mockImplementation(async () => {
    callOrder.push('authorize');
    return AGENT_ID;
  });
  pickup.mockClear();
  pickup.mockImplementation(async () => {
    callOrder.push('pickup-transaction');
    return RESULT;
  });
  touchNegotiationPickup.mockClear();
});

describe('hermetic negotiation pickup controller seam', () => {
  it('returns only the exact-principal service result and has no controller heartbeat writer', async () => {
    const outcome = await pickupNegotiationAtControllerBoundary({
      request: request(),
      agentId: AGENT_ID,
      ownerId: OWNER_ID,
      resolveAgentPrincipal,
      negotiations: { pickup },
    });

    expect(outcome).toEqual({ kind: 'authorized', value: RESULT });
    expect(pickup).toHaveBeenCalledWith(AGENT_ID, OWNER_ID, {
      agentId: AGENT_ID,
      credentialId: 'credential-current',
      audience: 'hermes-negotiator',
      setupAttemptId: 'setup-current',
    }, 'run-provider-free');
    expect(touchNegotiationPickup).not.toHaveBeenCalled();
    expect(callOrder).toEqual(['authorize', 'pickup-transaction']);
  });

  it('preserves an authorized empty transaction result without a second heartbeat', async () => {
    pickup.mockResolvedValueOnce(null);

    const outcome = await pickupNegotiationAtControllerBoundary({
      request: request(),
      agentId: AGENT_ID,
      ownerId: OWNER_ID,
      resolveAgentPrincipal,
      negotiations: { pickup },
    });

    expect(outcome).toEqual({ kind: 'empty' });
    expect(pickup).toHaveBeenCalledTimes(1);
    expect(touchNegotiationPickup).not.toHaveBeenCalled();
  });

  it.each([
    ['session or unbound owner key', null],
    ['different agent key', 'agent-other'],
  ] as const)('rejects a %s before the transaction service', async (_label, resolvedAgentId) => {
    resolveAgentPrincipal.mockResolvedValueOnce(resolvedAgentId);

    const outcome = await pickupNegotiationAtControllerBoundary({
      request: request({ kind: 'api_key', agentId: resolvedAgentId }),
      agentId: AGENT_ID,
      ownerId: OWNER_ID,
      resolveAgentPrincipal,
      negotiations: { pickup },
    });

    expect(outcome).toEqual({ kind: 'forbidden' });
    expect(pickup).not.toHaveBeenCalled();
    expect(touchNegotiationPickup).not.toHaveBeenCalled();
  });

  it.each([
    ['missing credential identity', { kind: 'api_key' as const, agentId: AGENT_ID }],
    ['mismatched recorded agent', { kind: 'api_key' as const, agentId: 'agent-other', credentialId: 'credential-current' }],
  ])('rejects %s even when the resolver claims the route agent', async (_label, context) => {
    const outcome = await pickupNegotiationAtControllerBoundary({
      request: request(context),
      agentId: AGENT_ID,
      ownerId: OWNER_ID,
      resolveAgentPrincipal,
      negotiations: { pickup },
    });

    expect(outcome).toEqual({ kind: 'forbidden' });
    expect(pickup).not.toHaveBeenCalled();
    expect(touchNegotiationPickup).not.toHaveBeenCalled();
  });
});

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
