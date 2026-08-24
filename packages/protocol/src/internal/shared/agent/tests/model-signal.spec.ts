import { describe, expect, it } from 'bun:test';

import { invokeWithAbortSignal } from '../model-signal';

describe('invokeWithAbortSignal deterministic invocation metadata', () => {
  it('forwards a durable timeout execution key without placing it in model input', async () => {
    let capturedInput: unknown;
    let capturedConfig: unknown;
    const runnable = {
      invoke: async (input: unknown, config?: unknown) => {
        capturedInput = input;
        capturedConfig = config;
        return 'ok';
      },
    };

    await expect(invokeWithAbortSignal(
      runnable,
      [{ role: 'user', content: 'hello' }],
      undefined,
      { metadata: { timeoutExecutionId: 'execution-1' }, tags: ['negotiation-timeout'] },
    )).resolves.toBe('ok');

    expect(capturedInput).toEqual([{ role: 'user', content: 'hello' }]);
    expect(capturedConfig).toEqual({
      metadata: { timeoutExecutionId: 'execution-1' },
      tags: ['negotiation-timeout'],
    });
  });
});
