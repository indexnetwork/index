/**
 * #1494 round-2 finding 2: nothing wrote lastNegotiationPickupAt after
 * pickup/claim was deleted, so the freshness gate
 * (AgentDispatcherImpl.dispatch → isNegotiationExecutorFresh) could never
 * see an external agent as fresh — external dispatch was permanently dead.
 * respond/respondHermes are the only remaining proof of an external agent's
 * liveness, so they must stamp the heartbeat on every authorized submission.
 */
import { describe, expect, it, mock } from 'bun:test';

import { NegotiationPollingService } from '../negotiation-polling.service';
import { NegotiationPollingAuthorization } from '../../lib/agent/negotiation-polling-authorization';

function mkService(overrides?: { touchPickup?: (agentId: string) => Promise<void> }) {
  const touchPickup = overrides?.touchPickup ?? mock(async () => {});
  const authorization = new NegotiationPollingAuthorization({
    getAgentWithRelations: async () => ({
      id: 'agent-1',
      ownerId: 'user-1',
      type: 'external',
      status: 'active',
      handleNegotiations: true,
      permissions: [{ userId: 'user-1', scope: 'global', actions: ['manage:negotiations'] }],
    }),
  });
  const database = {
    getNegotiationTask: async () => ({
      id: 'neg-1',
      metadata: { sourceUserId: 'user-1', candidateUserId: 'user-2' },
    }),
    getNegotiationMessages: async () => [],
  } as never;
  const graph = { invoke: async () => ({ status: 'ok' }) } as never;
  const service = new NegotiationPollingService(authorization, database, graph, touchPickup);
  return { service, touchPickup };
}

describe('NegotiationPollingService heartbeat', () => {
  it('respond touches the agent\'s negotiation-pickup heartbeat on an authorized submission', async () => {
    const { service, touchPickup } = mkService();
    await service.respond('agent-1', 'user-1', 'neg-1', { verb: 'outreach', message: 'hi' } as never, {} as never);
    expect(touchPickup).toHaveBeenCalledWith('agent-1');
  });

  it('respondHermes also touches the heartbeat', async () => {
    const { service, touchPickup } = mkService();
    await service.respondHermes('agent-1', 'user-1', 'neg-1', { action: 'outreach', message: 'hi' } as never, {} as never);
    expect(touchPickup).toHaveBeenCalledWith('agent-1');
  });

  it('an unauthorized caller never touches the heartbeat', async () => {
    const touchPickup = mock(async () => {});
    const authorization = new NegotiationPollingAuthorization({
      getAgentWithRelations: async () => null,
    });
    const service = new NegotiationPollingService(
      authorization,
      { getNegotiationTask: async () => null, getNegotiationMessages: async () => [] } as never,
      { invoke: async () => ({ status: 'ok' }) } as never,
      touchPickup,
    );
    await expect(service.respond('agent-1', 'user-1', 'neg-1', { verb: 'outreach', message: 'hi' } as never, {} as never))
      .rejects.toThrow();
    expect(touchPickup).not.toHaveBeenCalled();
  });
});
