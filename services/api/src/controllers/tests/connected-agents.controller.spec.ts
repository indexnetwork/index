import { beforeEach, describe, expect, it, mock } from 'bun:test';

import { SessionOnlyGuard } from '../../guards/auth.guard';
import { RouteRegistry } from '../../lib/router/router.decorators';
import { ConnectedAgentNotFoundError } from '../../services/connected-agents.service';
import { ConnectedAgentsController } from '../connected-agents.controller';

const OWNER = { id: 'owner-1', email: 'owner@example.com', name: 'Owner' };
const INSTALLATION_ID = '11111111-1111-4111-8111-111111111111';
const connection = {
  installationId: INSTALLATION_ID,
  agentId: '22222222-2222-4222-8222-222222222222',
  actions: ['manage:identity'],
  activationState: 'active' as const,
  selected: false,
  lastHeartbeatAt: null,
  expiresAt: '2026-09-08T12:00:00.000Z',
  health: 'never_seen' as const,
  indexCovering: true,
};
const list = mock(async () => ({ connections: [connection] }));
const pause = mock(async () => connection);
const revoke = mock(async () => ({ revoked: true as const }));
const reportUnexpected = mock((_error: unknown, _operation: string) => undefined);

function controller() {
  return new ConnectedAgentsController({ list, pause, revoke } as never, reportUnexpected);
}

describe('ConnectedAgentsController', () => {
  beforeEach(() => {
    list.mockClear();
    pause.mockClear();
    revoke.mockClear();
    reportUnexpected.mockClear();
    list.mockResolvedValue({ connections: [connection] });
    pause.mockResolvedValue(connection);
    revoke.mockResolvedValue({ revoked: true });
  });

  it('walls every owner control behind an actual browser session', () => {
    expect(RouteRegistry.getGuards(ConnectedAgentsController, 'list')).toContain(SessionOnlyGuard);
    expect(RouteRegistry.getGuards(ConnectedAgentsController, 'pause')).toContain(SessionOnlyGuard);
    expect(RouteRegistry.getGuards(ConnectedAgentsController, 'revoke')).toContain(SessionOnlyGuard);
  });

  it('lists only the session owner connections', async () => {
    const response = await controller().list(
      new Request('http://localhost/api/connected-agents/hermes'),
      OWNER,
    );
    expect(response.status).toBe(200);
    expect(list).toHaveBeenCalledWith(OWNER.id);
    expect(await response.json()).toEqual({ connections: [connection] });
  });

  it('requires a strict empty pause body and refreshes the exact owner installation', async () => {
    const valid = await controller().pause(
      new Request(`http://localhost/api/connected-agents/hermes/${INSTALLATION_ID}/pause`, { method: 'POST' }),
      OWNER,
      { installationId: INSTALLATION_ID },
    );
    expect(valid.status).toBe(200);
    expect(pause).toHaveBeenCalledWith(OWNER.id, INSTALLATION_ID);
    expect(await valid.json()).toEqual(connection);

    const extra = await controller().pause(
      new Request(`http://localhost/api/connected-agents/hermes/${INSTALLATION_ID}/pause`, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}',
      }),
      OWNER,
      { installationId: INSTALLATION_ID },
    );
    expect(extra.status).toBe(400);
    expect(pause).toHaveBeenCalledTimes(1);
  });

  it('revokes the exact installation and returns non-enumerating 404', async () => {
    const valid = await controller().revoke(
      new Request(`http://localhost/api/connected-agents/hermes/${INSTALLATION_ID}`, { method: 'DELETE' }),
      OWNER,
      { installationId: INSTALLATION_ID },
    );
    expect(valid.status).toBe(200);
    expect(revoke).toHaveBeenCalledWith(OWNER.id, INSTALLATION_ID);
    expect(await valid.json()).toEqual({ revoked: true });

    revoke.mockRejectedValueOnce(new ConnectedAgentNotFoundError());
    const absent = await controller().revoke(
      new Request(`http://localhost/api/connected-agents/hermes/${INSTALLATION_ID}`, { method: 'DELETE' }),
      OWNER,
      { installationId: INSTALLATION_ID },
    );
    expect(absent.status).toBe(404);
    expect(await absent.json()).toEqual({ error: 'connected_agent_not_found' });
  });

  it('sanitizes unexpected errors', async () => {
    const error = new Error('database leaked secret');
    list.mockRejectedValueOnce(error);
    const response = await controller().list(
      new Request('http://localhost/api/connected-agents/hermes'), OWNER,
    );
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: 'internal_error' });
    expect(reportUnexpected).toHaveBeenCalledWith(error, 'list');
  });
});
