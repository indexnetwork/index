/** Explicit isolated controller test: run this file directly. */
import { describe, expect, it, mock } from 'bun:test';

import { AgentActionController } from '../agent-action.controller';

const user = { id: 'user-1', email: 'alice@example.com', name: 'Alice' };

function request(body: unknown): Request {
  return new Request('http://localhost/api/agent/actions/confirm', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
  });
}

describe('AgentActionController isolated confirmation', () => {
  it('returns not found while the action flag is off', async () => {
    const controller = new AgentActionController({ confirm: mock(async () => ({ kind: 'not_found' as const })) }, () => false);
    const response = await controller.confirm(request({ proposalId: '11111111-1111-4111-8111-111111111111' }), user);
    expect(response.status).toBe(404);
  });

  it('validates and returns the service result when enabled', async () => {
    const service = {
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
    expect(service.confirm).toHaveBeenCalledWith(user.id, '11111111-1111-4111-8111-111111111111');
  });
});
