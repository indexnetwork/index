import { describe, expect, it } from 'bun:test';

import { authorizeNegotiationPickupPrincipal, authorizeNegotiationRespondPrincipal } from '../../guards/auth.guard';
import { NegotiationPollingAuthorization } from '../../lib/agent/negotiation-polling-authorization';
import { AgentRuntimeTransactionHarness } from '../../../tests/support/agent-runtime-transaction.harness';

const OWNER_ID = 'owner-1';
const AGENT_ID = 'agent-1';
const request = new Request(`http://localhost/agents/${AGENT_ID}/negotiations`);

const operations = [
  {
    name: 'pickup',
    principal: authorizeNegotiationPickupPrincipal,
    authorize: (service: NegotiationPollingAuthorization) => service.authorizePickup(AGENT_ID, OWNER_ID),
  },
  {
    name: 'respond',
    principal: authorizeNegotiationRespondPrincipal,
    authorize: (service: NegotiationPollingAuthorization) => service.authorizeRespond(AGENT_ID, OWNER_ID),
  },
] as const;

function authorizationHarness(
  overrides: Parameters<AgentRuntimeTransactionHarness['seedLegacyExecutor']>[0] = {},
): { persistence: AgentRuntimeTransactionHarness; service: NegotiationPollingAuthorization } {
  const persistence = new AgentRuntimeTransactionHarness();
  persistence.seedUser({ id: OWNER_ID, email: 'owner@example.com', name: 'Owner' });
  persistence.seedLegacyExecutor({ id: AGENT_ID, ownerId: OWNER_ID, ...overrides });
  return { persistence, service: new NegotiationPollingAuthorization(persistence) };
}

describe('pickup/respond controller principal authorization', () => {
  for (const operation of operations) {
    it(`${operation.name} accepts only the exact agent-bound key principal`, async () => {
      await expect(operation.principal(request, AGENT_ID, async () => AGENT_ID)).resolves.toBe(true);
      // Session and unbound-owner credentials both resolve to no agent binding.
      await expect(operation.principal(request, AGENT_ID, async () => null)).resolves.toBe(false);
      await expect(operation.principal(request, AGENT_ID, async () => null)).resolves.toBe(false);
      await expect(operation.principal(request, AGENT_ID, async () => 'wrong-agent')).resolves.toBe(false);
    });
  }
});

describe('pickup/respond selected executor service authorization', () => {
  for (const operation of operations) {
    it(`${operation.name} accepts the exact selected active legacy external agent with runtimeKind=null and permission`, async () => {
      const { persistence, service } = authorizationHarness();
      expect(persistence.snapshot().agents[0]?.runtimeKind).toBeNull();
      await expect(operation.authorize(service)).resolves.toBe(true);
    });

    it(`${operation.name} rejects unselected, inactive, wrong-type, wrong-owner, and permissionless agents`, async () => {
      for (const overrides of [
        { handleNegotiations: false },
        { status: 'inactive' as const },
        { type: 'personal' as const },
        { ownerId: 'other-owner' },
        { actions: [] },
      ]) {
        const { service } = authorizationHarness(overrides);
        await expect(operation.authorize(service)).resolves.toBe(false);
      }
    });
  }
});
