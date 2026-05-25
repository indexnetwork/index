import '../src/startup.env';

import { beforeEach, describe, expect, it } from 'bun:test';

import { AgentController } from '../src/controllers/agent.controller';
import type { PickupResult } from '../src/services/agent-test-message.service';
import { agentService } from '../src/services/agent.service';

const OWNER_ID = 'owner-1';
const AGENT_ID = 'agent-1';
const MESSAGE_ID = 'msg-1';

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

describe('AgentController — test-message routes', () => {
  let controller: AgentController;

  // Originals so we can restore after each test
  let origGetById: typeof agentService.getById;

  beforeEach(() => {
    controller = new AgentController();
    origGetById = agentService.getById;
    // Default: user owns the agent (getById does not throw)
    agentService.getById = async () => ({}) as never;
  });

  // afterEach restores originals
  // (bun:test does not have afterEach in older versions, use try/finally pattern inline)

  describe('POST /agents/:id/test-messages (enqueueTestMessage)', () => {
    it('returns 201 with id when content is valid and user owns agent', async () => {
      // Import the module-level singleton service to mock it
      // We access it via the closure captured by the controller
      const { AgentTestMessageService } = await import('../src/services/agent-test-message.service');
      const proto = AgentTestMessageService.prototype;
      const origEnqueue = proto.enqueue;

      proto.enqueue = async (_agentId, _userId, _content) => ({ id: MESSAGE_ID });

      try {
        const res = await controller.enqueueTestMessage(
          makeRequest({ content: 'hello world' }),
          makeUser(),
          makeParams(),
        );
        expect(res.status).toBe(201);
        const json = await res.json() as { id: string };
        expect(json.id).toBe(MESSAGE_ID);
      } finally {
        proto.enqueue = origEnqueue;
        agentService.getById = origGetById;
      }
    });

    it('returns 400 when content is empty string', async () => {
      try {
        const res = await controller.enqueueTestMessage(
          makeRequest({ content: '   ' }),
          makeUser(),
          makeParams(),
        );
        expect(res.status).toBe(400);
        const json = await res.json() as { error: string };
        expect(json.error).toBe('content is required');
      } finally {
        agentService.getById = origGetById;
      }
    });

    it('returns 400 when content is missing', async () => {
      try {
        const res = await controller.enqueueTestMessage(
          makeRequest({}),
          makeUser(),
          makeParams(),
        );
        expect(res.status).toBe(400);
      } finally {
        agentService.getById = origGetById;
      }
    });

    it('returns 400 when body is missing entirely', async () => {
      try {
        const res = await controller.enqueueTestMessage(
          new Request('http://localhost/', { method: 'POST' }),
          makeUser(),
          makeParams(),
        );
        expect(res.status).toBe(400);
      } finally {
        agentService.getById = origGetById;
      }
    });

    it('returns 400 when agentId param is missing', async () => {
      try {
        const res = await controller.enqueueTestMessage(
          makeRequest({ content: 'hello' }),
          makeUser(),
          {},
        );
        expect(res.status).toBe(400);
      } finally {
        agentService.getById = origGetById;
      }
    });

    it('returns 404 when getById throws "Agent not found"', async () => {
      agentService.getById = async () => { throw new Error('Agent not found'); };
      try {
        const res = await controller.enqueueTestMessage(
          makeRequest({ content: 'hello' }),
          makeUser(),
          makeParams(),
        );
        expect(res.status).toBe(404);
      } finally {
        agentService.getById = origGetById;
      }
    });

    it('returns 403 when getById throws "Not authorized"', async () => {
      agentService.getById = async () => { throw new Error('Not authorized'); };
      try {
        const res = await controller.enqueueTestMessage(
          makeRequest({ content: 'hello' }),
          makeUser(),
          makeParams(),
        );
        expect(res.status).toBe(403);
      } finally {
        agentService.getById = origGetById;
      }
    });
  });

  describe('POST /agents/:id/test-messages/pickup (pickupTestMessage)', () => {
    it('returns 204 when no message is available', async () => {
      const { AgentTestMessageService } = await import('../src/services/agent-test-message.service');
      const proto = AgentTestMessageService.prototype;
      const origPickup = proto.pickup;

      proto.pickup = async () => null;

      try {
        const res = await controller.pickupTestMessage(
          makeRequest(undefined),
          makeUser(),
          makeParams(),
        );
        expect(res.status).toBe(204);
      } finally {
        proto.pickup = origPickup;
      }
    });

    it('returns 200 with pickup payload when a message is available', async () => {
      const { AgentTestMessageService } = await import('../src/services/agent-test-message.service');
      const proto = AgentTestMessageService.prototype;
      const origPickup = proto.pickup;

      const pickupResult: PickupResult = {
        id: MESSAGE_ID,
        content: 'test content',
        reservationToken: 'token-abc',
        reservationExpiresAt: new Date('2026-04-15T12:00:00.000Z'),
      };

      proto.pickup = async () => pickupResult;

      try {
        const res = await controller.pickupTestMessage(
          makeRequest(undefined),
          makeUser(),
          makeParams(),
        );
        expect(res.status).toBe(200);
        const json = await res.json() as PickupResult;
        expect(json.id).toBe(MESSAGE_ID);
        expect(json.content).toBe('test content');
        expect(json.reservationToken).toBe('token-abc');
      } finally {
        proto.pickup = origPickup;
      }
    });

    it('returns 400 when agentId param is missing', async () => {
      const res = await controller.pickupTestMessage(
        makeRequest(undefined),
        makeUser(),
        {},
      );
      expect(res.status).toBe(400);
    });
  });

  describe('POST /agents/:id/test-messages/:messageId/delivered (confirmTestMessageDelivered)', () => {
    it('returns 200 with { ok: true } on success', async () => {
      const { AgentTestMessageService } = await import('../src/services/agent-test-message.service');
      const proto = AgentTestMessageService.prototype;
      const origConfirm = proto.confirmDelivered;

      proto.confirmDelivered = async () => undefined;

      try {
        const res = await controller.confirmTestMessageDelivered(
          makeRequest({ reservationToken: 'tok-abc' }),
          makeUser(),
          makeParams({ id: AGENT_ID, messageId: MESSAGE_ID }),
        );
        expect(res.status).toBe(200);
        const json = await res.json() as { ok: boolean };
        expect(json.ok).toBe(true);
      } finally {
        proto.confirmDelivered = origConfirm;
      }
    });

    it('returns 404 when token is invalid or message already delivered', async () => {
      const { AgentTestMessageService } = await import('../src/services/agent-test-message.service');
      const proto = AgentTestMessageService.prototype;
      const origConfirm = proto.confirmDelivered;

      proto.confirmDelivered = async () => { throw new Error('invalid_reservation_token_or_already_delivered'); };

      try {
        const res = await controller.confirmTestMessageDelivered(
          makeRequest({ reservationToken: 'bad-token' }),
          makeUser(),
          makeParams({ id: AGENT_ID, messageId: MESSAGE_ID }),
        );
        expect(res.status).toBe(404);
      } finally {
        proto.confirmDelivered = origConfirm;
      }
    });

    it('returns 400 when reservationToken is missing', async () => {
      const res = await controller.confirmTestMessageDelivered(
        makeRequest({}),
        makeUser(),
        makeParams({ id: AGENT_ID, messageId: MESSAGE_ID }),
      );
      expect(res.status).toBe(400);
    });

    it('returns 400 when agentId or messageId params are missing', async () => {
      const resNoAgent = await controller.confirmTestMessageDelivered(
        makeRequest({ reservationToken: 'tok' }),
        makeUser(),
        {},
      );
      expect(resNoAgent.status).toBe(400);

      const resNoMessage = await controller.confirmTestMessageDelivered(
        makeRequest({ reservationToken: 'tok' }),
        makeUser(),
        { id: AGENT_ID },
      );
      expect(resNoMessage.status).toBe(400);
    });
  });
});
