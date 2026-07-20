import { beforeEach, describe, expect, it, mock } from 'bun:test';
import { ChatContextAccessError } from '@indexnetwork/protocol';

import { ToolController } from '../tool.controller';

const user = { id: 'user-1', email: 'user@example.com', name: 'User' } as never;
let invokeTool: ReturnType<typeof mock>;
let listTools: ReturnType<typeof mock>;
let controller: ToolController;

beforeEach(() => {
  invokeTool = mock(async () => ({ ok: true }));
  listTools = mock(async () => [{ name: 'read_intents' }]);
  controller = new ToolController({ invokeTool, listTools } as never);
});

describe('ToolController deterministic contract', () => {
  it('forwards user, tool name, and query to the injected service', async () => {
    const request = new Request('http://localhost/tools/read_intents', {
      method: 'POST',
      body: JSON.stringify({ query: { networkId: 'network-1' } }),
    });

    const response = await controller.invoke(request, user, { toolName: 'read_intents' });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
    expect(invokeTool).toHaveBeenCalledWith('user-1', 'read_intents', {
      networkId: 'network-1',
    });
  });

  it('uses an empty query when JSON parsing fails', async () => {
    const request = new Request('http://localhost/tools/read_intents', {
      method: 'POST',
      body: '{',
    });

    expect((await controller.invoke(request, user, { toolName: 'read_intents' })).status).toBe(200);
    expect(invokeTool).toHaveBeenCalledWith('user-1', 'read_intents', {});
  });

  it('rejects malformed query input before invoking the service', async () => {
    const request = new Request('http://localhost/tools/read_intents', {
      method: 'POST',
      body: JSON.stringify({ query: 'not-an-object' }),
    });

    const response = await controller.invoke(request, user, { toolName: 'read_intents' });

    expect(response.status).toBe(400);
    expect(invokeTool).not.toHaveBeenCalled();
  });

  it('maps context access errors without provider calls', async () => {
    invokeTool.mockImplementation(async () => {
      throw new ChatContextAccessError('membership required', 403, 'INDEX_MEMBERSHIP_REQUIRED');
    });

    const response = await controller.invoke(
      new Request('http://localhost/tools/read_intents', { method: 'POST' }),
      user,
      { toolName: 'read_intents' },
    );

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({
      error: 'membership required',
      code: 'INDEX_MEMBERSHIP_REQUIRED',
    });
  });

  it('maps not-found, validation, and unexpected service errors', async () => {
    for (const [error, status] of [
      [new Error('Tool not found'), 404],
      [new Error('Invalid query: intentId is required'), 400],
      [new Error('unexpected'), 500],
    ] as const) {
      invokeTool.mockImplementationOnce(async () => {
        throw error;
      });
      const response = await controller.invoke(
        new Request('http://localhost/tools/read_intents', { method: 'POST' }),
        user,
        { toolName: 'read_intents' },
      );
      expect(response.status).toBe(status);
    }
  });

  it('lists tools through the injected service and maps list failures', async () => {
    const success = await controller.list(new Request('http://localhost/tools'), user);
    expect(success.status).toBe(200);
    expect(await success.json()).toEqual({ tools: [{ name: 'read_intents' }] });

    listTools.mockImplementationOnce(async () => {
      throw new Error('unavailable');
    });
    const failure = await controller.list(new Request('http://localhost/tools'), user);
    expect(failure.status).toBe(500);
    expect(await failure.json()).toEqual({ error: 'Internal server error' });
  });
});
