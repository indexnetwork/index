/**
 * Wire contract for POST /api/opportunities/:id/reopen.
 *
 * The floor page wires its Reopen button straight to these codes and this body,
 * so they are pinned here against the controller with a stubbed service: 202
 * `{ opportunityId, status: 'stalled', enqueued: true }` on success, 403 for a
 * non-actor, and 409 (carrying `taskId` when a negotiation is in flight) for a
 * match that is not a dead end. The behaviour behind them lives in
 * `src/services/tests/opportunity.service.reopen.spec.ts`.
 */
import { config } from 'dotenv';
config({ path: '.env.test', override: true });

import { afterAll, beforeAll, describe, expect, mock, test } from 'bun:test';

import type { AuthenticatedUser } from '../../guards/auth.guard';
import { RouteRegistry } from '../../lib/router/router.decorators';

const OPP_ID = '11111111-1111-4111-8111-111111111111';

const reopenOpportunity = mock(async (..._args: unknown[]) => ({}) as unknown);
const resolveId = mock(async () => ({ id: OPP_ID }) as unknown);

mock.module('../../queues/notification.queue', () => ({
  queueOpportunityNotification: async () => ({ id: 'mock-job' }),
}));
mock.module('../../services/opportunity.service', () => ({
  opportunityService: { resolveId, reopenOpportunity },
}));

let OpportunityControllerClass: typeof import('../opportunity.controller').OpportunityController;

beforeAll(async () => {
  OpportunityControllerClass = (await import('../opportunity.controller')).OpportunityController;
});

afterAll(() => {
  mock.restore();
});

const user: AuthenticatedUser = { id: 'user-actor-1', email: 'actor@example.com', name: 'Actor' };

function request() {
  return new Request(`http://localhost/api/opportunities/${OPP_ID}/reopen`, { method: 'POST' });
}

async function callReopen() {
  const response = await new OpportunityControllerClass().reopen(request(), user, { id: OPP_ID });
  return { response, body: await response.json() as Record<string, unknown> };
}

describe('POST /api/opportunities/:id/reopen', () => {
  test('the route is registered on the opportunity controller', async () => {
    const { OpportunityController } = await import('../opportunity.controller');
    const routes = RouteRegistry.getRoutes(OpportunityController);
    expect(routes.some((route) => route.method === 'POST' && route.path === '/:id/reopen')).toBe(true);
  });

  test('202 with the enqueued payload the floor page reads', async () => {
    reopenOpportunity.mockResolvedValueOnce({ opportunityId: OPP_ID, status: 'stalled', enqueued: true });

    const { response, body } = await callReopen();

    expect(response.status).toBe(202);
    expect(body).toEqual({ opportunityId: OPP_ID, status: 'stalled', enqueued: true });
  });

  test('403 for a non-actor', async () => {
    reopenOpportunity.mockResolvedValueOnce({ error: 'Not authorized to reopen this opportunity', status: 403 });

    const { response, body } = await callReopen();

    expect(response.status).toBe(403);
    expect(body).toEqual({ error: 'Not authorized to reopen this opportunity' });
  });

  test('409 carries the live task id', async () => {
    reopenOpportunity.mockResolvedValueOnce({
      error: 'This match already has a negotiation in flight',
      status: 409,
      taskId: 'task-live-1',
    });

    const { response, body } = await callReopen();

    expect(response.status).toBe(409);
    expect(body).toEqual({ error: 'This match already has a negotiation in flight', taskId: 'task-live-1' });
  });

  test('409 without a task id for a pending match', async () => {
    reopenOpportunity.mockResolvedValueOnce({
      error: 'Only a rejected, stalled, or expired match can be reopened (this one is pending)',
      status: 409,
    });

    const { response, body } = await callReopen();

    expect(response.status).toBe(409);
    expect(body).toEqual({
      error: 'Only a rejected, stalled, or expired match can be reopened (this one is pending)',
    });
  });
});
