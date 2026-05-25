/** Config */
import { config } from "dotenv";
config({ path: '.env.test', override: true });

import { describe, it, expect } from "bun:test";
import { requestContext } from "../request-context.js";

describe('requestContext', () => {
  it('returns undefined outside of a run() scope', () => {
    expect(requestContext.getStore()).toBeUndefined();
  });

  it('returns the stored context inside a run() scope', async () => {
    let capturedOriginUrl: string | undefined;
    await new Promise<void>((resolve) => {
      requestContext.run({ originUrl: 'https://test.example.com' }, () => {
        capturedOriginUrl = requestContext.getStore()?.originUrl;
        resolve();
      });
    });
    expect(capturedOriginUrl).toBe('https://test.example.com');
  });

  it('traceEmitter is callable from within the run scope', async () => {
    const events: string[] = [];
    await new Promise<void>((resolve) => {
      requestContext.run({
        traceEmitter: (event) => events.push(event.name),
      }, () => {
        const store = requestContext.getStore();
        store?.traceEmitter?.({ type: 'graph_start', name: 'test-graph' });
        resolve();
      });
    });
    expect(events).toContain('test-graph');
  });

  it('context does not bleed across run() scopes', async () => {
    const results: (string | undefined)[] = [];
    await Promise.all([
      new Promise<void>((resolve) => {
        requestContext.run({ originUrl: 'https://scope-a.example.com' }, () => {
          results[0] = requestContext.getStore()?.originUrl;
          resolve();
        });
      }),
      new Promise<void>((resolve) => {
        requestContext.run({ originUrl: 'https://scope-b.example.com' }, () => {
          results[1] = requestContext.getStore()?.originUrl;
          resolve();
        });
      }),
    ]);
    expect(results[0]).toBe('https://scope-a.example.com');
    expect(results[1]).toBe('https://scope-b.example.com');
  });
});
