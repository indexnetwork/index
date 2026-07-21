/** Config */
import { config } from 'dotenv';
config({ path: '.env.test', override: true });

import { afterAll, beforeAll, describe, expect, mock, test } from 'bun:test';

import type { AuthenticatedUser } from '../../guards/auth.guard';
import { recordRequestAuthContext } from '../../lib/request-auth-context';
import { setDeprecationReporter } from '../../lib/router/deprecated-route';

mock.module('../../queues/notification.queue', () => ({
  queueOpportunityNotification: async () => ({ id: 'mock-job' }),
}));

let OpportunityControllerClass: typeof import('../opportunity.controller').OpportunityController;
const warnReporter = mock((_message: string, _metadata: Record<string, unknown>) => {});
const restoreReporter = setDeprecationReporter(warnReporter);

beforeAll(async () => {
  const mod = await import('../opportunity.controller');
  OpportunityControllerClass = mod.OpportunityController;
});

afterAll(() => {
  restoreReporter();
  mock.restore();
});

describe('deprecated controller routes', () => {
  test('adds the deprecation header and emits one structured warning', async () => {
    warnReporter.mockClear();
    const req = new Request(
      'http://localhost/api/opportunities/example/connect-token?noise=secret-query',
      { method: 'POST', headers: { 'x-api-key': 'secret-api-key' } },
    );
    const agentId = crypto.randomUUID();
    recordRequestAuthContext(req, { kind: 'api_key', agentId });
    const user: AuthenticatedUser = {
      id: crypto.randomUUID(),
      email: 'deprecated-route@example.com',
      name: 'Deprecated Route Test',
    };

    try {
      const response = await new OpportunityControllerClass().createConnectToken(req, user);
      const body = (await response.json()) as { error: string };

      expect(response.status).toBe(400);
      expect(body).toEqual({ error: 'Missing opportunity id' });
      expect(response.headers.get('Deprecation')).toBe('true');
      expect(warnReporter).toHaveBeenCalledTimes(1);

      const warning = JSON.stringify(warnReporter.mock.calls[0] ?? []);
      expect(warning).toContain('Deprecated API route used');
      expect(warning).toContain('"routeId":"opportunity.connect-token"');
      expect(warning).toContain('"method":"POST"');
      expect(warning).toContain('"path":"/api/opportunities/example/connect-token"');
      expect(warning).toContain('"authKind":"api_key"');
      expect(warning).toContain(`"agentId":"${agentId}"`);
      expect(warning).not.toContain('secret-query');
      expect(warning).not.toContain('secret-api-key');
    } finally {
      warnReporter.mockClear();
    }
  });
});
