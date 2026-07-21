/** Explicit isolated controller test: run this file directly. */
import { describe, expect, it, mock } from 'bun:test';

import { AgentActionController } from '../agent-action.controller';

const user = { id: 'user-1', email: 'alice@example.com', name: 'Alice' };

const PROPOSAL_ID = '11111111-1111-4111-8111-111111111111';

function request(body: unknown): Request {
  return new Request('http://localhost/api/agent/actions/confirm', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
  });
}

describe('AgentActionController isolated confirmation', () => {
  it('returns not found without reading or confirming while the action flag is off', async () => {
    const service = {
      readProposal: mock(async () => null),
      confirm: mock(async () => ({ kind: 'not_found' as const })),
    };
    const controller = new AgentActionController(service, () => false);
    const readResponse = await controller.readProposal(request({}), user, { proposalId: PROPOSAL_ID });
    const confirmResponse = await controller.confirm(request({ proposalId: PROPOSAL_ID }), user);
    expect(readResponse.status).toBe(404);
    expect(confirmResponse.status).toBe(404);
    expect(service.readProposal).not.toHaveBeenCalled();
    expect(service.confirm).not.toHaveBeenCalled();
  });

  it('validates and returns the service result when enabled', async () => {
    const service = {
      readProposal: mock(async () => null),
      confirm: mock(async () => ({
        kind: 'success' as const,
        result: {
          proposalId: '11111111-1111-4111-8111-111111111111',
          status: 'consumed' as const,
          results: [],
        },
      })),
    };
    const controller = new AgentActionController(service, () => true);
    const response = await controller.confirm(request({ proposalId: '11111111-1111-4111-8111-111111111111' }), user);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ success: true, status: 'consumed' });
    expect(service.confirm).toHaveBeenCalledWith(user.id, PROPOSAL_ID);
  });

  it('validates proposal ids before the owner-scoped read', async () => {
    const service = { readProposal: mock(async () => null), confirm: mock(async () => ({ kind: 'not_found' as const })) };
    const controller = new AgentActionController(service, () => true);
    const response = await controller.readProposal(request({}), user, { proposalId: 'not-a-uuid' });
    expect(response.status).toBe(400);
    expect(service.readProposal).not.toHaveBeenCalled();
  });

  it('returns not found for a missing or cross-owner proposal', async () => {
    const service = { readProposal: mock(async () => null), confirm: mock(async () => ({ kind: 'not_found' as const })) };
    const controller = new AgentActionController(service, () => true);
    const response = await controller.readProposal(request({}), user, { proposalId: PROPOSAL_ID });
    expect(response.status).toBe(404);
    expect(service.readProposal).toHaveBeenCalledWith(user.id, PROPOSAL_ID);
  });

  it('returns pending canonical actions without snapshots', async () => {
    const service = {
      readProposal: mock(async () => ({
        proposalId: PROPOSAL_ID,
        status: 'pending' as const,
        actions: [{ type: 'narrow_signal' as const, entityId: 'intent-1', currentState: 'ACTIVE', proposedOperation: 'NARROW_SIGNAL', description: 'Canonical replacement' }],
        results: null,
      })),
      confirm: mock(async () => ({ kind: 'not_found' as const })),
    };
    const controller = new AgentActionController(service, () => true);
    const response = await controller.readProposal(request({}), user, { proposalId: PROPOSAL_ID });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      success: true,
      proposalId: PROPOSAL_ID,
      status: 'pending',
      actions: [{ type: 'narrow_signal', entityId: 'intent-1', currentState: 'ACTIVE', proposedOperation: 'NARROW_SIGNAL', description: 'Canonical replacement' }],
      results: null,
    });
  });

  it('returns consumed canonical results for replay-safe hydration', async () => {
    const service = {
      readProposal: mock(async () => ({ proposalId: PROPOSAL_ID, status: 'consumed' as const, actions: [], results: [{ type: 'pause_signal' as const, entityId: 'intent-1', operation: 'PAUSE_SIGNAL', previousState: 'ACTIVE', resultingState: 'PAUSED', outcome: 'alreadyDone' as const }] })),
      confirm: mock(async () => ({ kind: 'not_found' as const })),
    };
    const controller = new AgentActionController(service, () => true);
    const response = await controller.readProposal(request({}), user, { proposalId: PROPOSAL_ID });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ status: 'consumed', results: [{ outcome: 'alreadyDone' }] });
  });
});
