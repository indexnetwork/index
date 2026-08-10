import { describe, expect, it } from 'bun:test';

import { authorizeNegotiationPickupPrincipal, authorizeNegotiationRespondPrincipal } from '../../guards/auth.guard';
import { NegotiationPollingAuthorization } from '../../lib/agent/negotiation-polling-authorization';
import { AgentRuntimeTransactionHarness } from '../../../tests/support/agent-runtime-transaction.harness';
import { HERMES_AGENT_AUDIENCE } from '../../lib/agent/hermes-authorization';
import { HERMES_CANONICAL_ACTIONS } from '../../lib/agent/hermes-capabilities';

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

describe('full Hermes transaction-time negotiation authority', () => {
  function fullHarness(overrides: Parameters<AgentRuntimeTransactionHarness['seedFullHermesExecutor']>[0] = {}) {
    const persistence = new AgentRuntimeTransactionHarness();
    persistence.seedUser({ id: OWNER_ID, email: 'owner@example.com', name: 'Owner' });
    const seeded = persistence.seedFullHermesExecutor({ id: AGENT_ID, ownerId: OWNER_ID, ...overrides });
    const principal = {
      credentialId: seeded.credentialId,
      agentId: seeded.agentId,
      audience: HERMES_AGENT_AUDIENCE,
      installationId: seeded.installationId,
      setupAttemptId: seeded.setupAttemptId,
      actions: [...HERMES_CANONICAL_ACTIONS],
    } as const;
    return { persistence, principal };
  }

  it('admits only the selected active full principal with canonical manage:negotiations authority', async () => {
    const { persistence, principal } = fullHarness();
    await expect(persistence.attemptNegotiationMutation(OWNER_ID, principal)).resolves.toBe(true);
    expect(persistence.negotiationMutationCount()).toBe(1);
  });

  it('rechecks active row, expiry, generation, installation, selection, and canonical actions under the mutation lock', async () => {
    const cases = [
      fullHarness({ activationState: 'pending' }),
      fullHarness({ activationState: 'revoked' }),
      fullHarness({ expiresAt: new Date(0) }),
      fullHarness({ handleNegotiations: false }),
      fullHarness({ actions: HERMES_CANONICAL_ACTIONS.slice(0, -1) }),
    ];
    for (const { persistence, principal } of cases) {
      await expect(persistence.attemptNegotiationMutation(OWNER_ID, principal)).resolves.toBe(false);
      expect(persistence.negotiationMutationCount()).toBe(0);
    }

    const wrongGeneration = fullHarness();
    await expect(wrongGeneration.persistence.attemptNegotiationMutation(OWNER_ID, {
      ...wrongGeneration.principal,
      setupAttemptId: 'other-setup',
    })).resolves.toBe(false);

    const wrongInstallation = fullHarness();
    await expect(wrongInstallation.persistence.attemptNegotiationMutation(OWNER_ID, {
      ...wrongInstallation.principal,
      installationId: 'other-installation',
    })).resolves.toBe(false);

    const retiredActions = fullHarness();
    await expect(retiredActions.persistence.attemptNegotiationMutation(OWNER_ID, {
      ...retiredActions.principal,
      actions: [...HERMES_CANONICAL_ACTIONS, 'manage:profile'] as never,
    })).resolves.toBe(false);
  });

  it('serializes revocation between preflight and mutation so no stale full-principal mutation commits', async () => {
    const { persistence, principal } = fullHarness();
    await expect(persistence.attemptNegotiationMutation(OWNER_ID, principal, async () => {
      persistence.revokeCredentialsForAgent(AGENT_ID);
    })).resolves.toBe(false);
    expect(persistence.negotiationMutationCount()).toBe(0);
  });
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
