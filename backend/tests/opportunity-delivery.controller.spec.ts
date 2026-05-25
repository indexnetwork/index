import '../src/startup.env';

import { beforeEach, describe, expect, it } from 'bun:test';

import { AgentController } from '../src/controllers/agent.controller';
import type { PickupPendingResult } from '../src/services/opportunity-delivery.service';
import { agentService } from '../src/services/agent.service';

const OWNER_ID = 'owner-1';
const AGENT_ID = 'agent-1';
const OPPORTUNITY_ID = 'opp-1';

function makeUser(id = OWNER_ID) {
  return { id } as never;
}

function makeParams(overrides: Record<string, string> = {}) {
  return { id: AGENT_ID, ...overrides };
}

function makeRequest(body?: unknown, method = 'POST') {
  if (body === undefined) {
    return new Request('http://localhost/', { method });
  }
  return new Request('http://localhost/', {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('AgentController — opportunity-delivery routes', () => {
  let controller: AgentController;

  let origGetById: typeof agentService.getById;

  beforeEach(() => {
    controller = new AgentController();
    origGetById = agentService.getById;
    // Default: user owns the agent (getById does not throw)
    agentService.getById = async () => ({}) as never;
  });

  describe('POST /agents/:id/opportunities/pickup (pickupOpportunity)', () => {
    it('returns 204 when service returns null (no pending opportunity)', async () => {
      const { OpportunityDeliveryService } = await import('../src/services/opportunity-delivery.service');
      const proto = OpportunityDeliveryService.prototype;
      const origPickup = proto.pickupPending;

      proto.pickupPending = async () => null;

      try {
        const res = await controller.pickupOpportunity(
          makeRequest(undefined),
          makeUser(),
          makeParams(),
        );
        expect(res.status).toBe(204);
      } finally {
        proto.pickupPending = origPickup;
        agentService.getById = origGetById;
      }
    });

    it('returns 200 with rendered payload when service returns a result', async () => {
      const { OpportunityDeliveryService } = await import('../src/services/opportunity-delivery.service');
      const proto = OpportunityDeliveryService.prototype;
      const origPickup = proto.pickupPending;

      const pickupResult: PickupPendingResult = {
        opportunityId: OPPORTUNITY_ID,
        reservationToken: 'tok-abc',
        reservationExpiresAt: new Date('2026-04-15T12:00:00.000Z'),
        rendered: {
          headline: 'Great match!',
          personalizedSummary: 'You should connect.',
          suggestedAction: 'Reach out on LinkedIn.',
          narratorRemark: 'High overlap in interests.',
        },
      };

      proto.pickupPending = async () => pickupResult;

      try {
        const res = await controller.pickupOpportunity(
          makeRequest(undefined),
          makeUser(),
          makeParams(),
        );
        expect(res.status).toBe(200);
        const json = await res.json() as PickupPendingResult;
        expect(json.opportunityId).toBe(OPPORTUNITY_ID);
        expect(json.reservationToken).toBe('tok-abc');
        expect(json.rendered.headline).toBe('Great match!');
      } finally {
        proto.pickupPending = origPickup;
        agentService.getById = origGetById;
      }
    });

    it('returns 404 when agent not owned (agentService.getById throws "Agent not found")', async () => {
      agentService.getById = async () => { throw new Error('Agent not found'); };

      try {
        const res = await controller.pickupOpportunity(
          makeRequest(undefined),
          makeUser(),
          makeParams(),
        );
        expect(res.status).toBe(404);
      } finally {
        agentService.getById = origGetById;
      }
    });

    it('returns 400 when agentId param is missing', async () => {
      const res = await controller.pickupOpportunity(
        makeRequest(undefined),
        makeUser(),
        {},
      );
      expect(res.status).toBe(400);
    });
  });

  describe('POST /agents/:id/opportunities/:opportunityId/delivered (confirmOpportunityDelivered)', () => {
    it('returns 200 with { ok: true } when confirmDelivered succeeds', async () => {
      const { OpportunityDeliveryService } = await import('../src/services/opportunity-delivery.service');
      const proto = OpportunityDeliveryService.prototype;
      const origConfirm = proto.confirmDelivered;

      proto.confirmDelivered = async () => undefined;

      try {
        const res = await controller.confirmOpportunityDelivered(
          makeRequest({ reservationToken: 'tok-abc' }),
          makeUser(),
          makeParams({ id: AGENT_ID, opportunityId: OPPORTUNITY_ID }),
        );
        expect(res.status).toBe(200);
        const json = await res.json() as { ok: boolean };
        expect(json.ok).toBe(true);
      } finally {
        proto.confirmDelivered = origConfirm;
        agentService.getById = origGetById;
      }
    });

    it('returns 404 when reservation token is invalid or already delivered', async () => {
      const { OpportunityDeliveryService } = await import('../src/services/opportunity-delivery.service');
      const proto = OpportunityDeliveryService.prototype;
      const origConfirm = proto.confirmDelivered;

      proto.confirmDelivered = async () => {
        throw new Error('invalid_reservation_token_or_already_delivered');
      };

      try {
        const res = await controller.confirmOpportunityDelivered(
          makeRequest({ reservationToken: 'bad-token' }),
          makeUser(),
          makeParams({ id: AGENT_ID, opportunityId: OPPORTUNITY_ID }),
        );
        expect(res.status).toBe(404);
      } finally {
        proto.confirmDelivered = origConfirm;
        agentService.getById = origGetById;
      }
    });

    it('returns 400 when reservationToken is missing from body', async () => {
      const res = await controller.confirmOpportunityDelivered(
        makeRequest({}),
        makeUser(),
        makeParams({ id: AGENT_ID, opportunityId: OPPORTUNITY_ID }),
      );
      expect(res.status).toBe(400);
      const json = await res.json() as { error: string };
      expect(json.error).toMatch(/reservationToken|Required/);
    });

    it('returns 400 when agentId or opportunityId params are missing', async () => {
      const resNoAgent = await controller.confirmOpportunityDelivered(
        makeRequest({ reservationToken: 'tok' }),
        makeUser(),
        {},
      );
      expect(resNoAgent.status).toBe(400);

      const resNoOpportunity = await controller.confirmOpportunityDelivered(
        makeRequest({ reservationToken: 'tok' }),
        makeUser(),
        { id: AGENT_ID },
      );
      expect(resNoOpportunity.status).toBe(400);
    });

    it('returns 404 when agent not owned (agentService.getById throws "Agent not found")', async () => {
      agentService.getById = async () => { throw new Error('Agent not found'); };

      const { OpportunityDeliveryService } = await import('../src/services/opportunity-delivery.service');
      const proto = OpportunityDeliveryService.prototype;
      const origConfirm = proto.confirmDelivered;
      proto.confirmDelivered = async () => undefined;

      try {
        const res = await controller.confirmOpportunityDelivered(
          makeRequest({ reservationToken: 'tok' }),
          makeUser(),
          makeParams({ id: AGENT_ID, opportunityId: OPPORTUNITY_ID }),
        );
        expect(res.status).toBe(404);
      } finally {
        proto.confirmDelivered = origConfirm;
        agentService.getById = origGetById;
      }
    });
  });
});
