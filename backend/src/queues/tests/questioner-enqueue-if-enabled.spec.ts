/**
 * Unit tests for questionerEnqueueIfEnabled — the env-gated enqueue used by
 * graph/tool composition sites (MCP root, enrichment, profile-run,
 * discovery-run queues). Gating only; the returned closure delegates to the
 * singleton queue and is exercised by integration paths.
 */
process.env.DATABASE_URL = process.env.DATABASE_URL ?? 'postgresql://unused:unused@localhost:5432/unused';

import { afterEach, describe, expect, it } from 'bun:test';

import { questionerEnqueueIfEnabled } from '../questioner.queue';

const originalFlag = process.env.QUESTIONER_ENABLED;

afterEach(() => {
  if (originalFlag === undefined) {
    delete process.env.QUESTIONER_ENABLED;
  } else {
    process.env.QUESTIONER_ENABLED = originalFlag;
  }
});

describe('questionerEnqueueIfEnabled', () => {
  it('returns undefined when QUESTIONER_ENABLED is unset', () => {
    delete process.env.QUESTIONER_ENABLED;
    expect(questionerEnqueueIfEnabled()).toBeUndefined();
  });

  it('returns undefined when QUESTIONER_ENABLED is not "true"', () => {
    process.env.QUESTIONER_ENABLED = 'false';
    expect(questionerEnqueueIfEnabled()).toBeUndefined();
    process.env.QUESTIONER_ENABLED = '1';
    expect(questionerEnqueueIfEnabled()).toBeUndefined();
  });

  it('returns an enqueue function when QUESTIONER_ENABLED is "true"', () => {
    process.env.QUESTIONER_ENABLED = 'true';
    const fn = questionerEnqueueIfEnabled();
    expect(typeof fn).toBe('function');
  });

  it('re-reads the flag on every call (no caching)', () => {
    process.env.QUESTIONER_ENABLED = 'true';
    expect(questionerEnqueueIfEnabled()).toBeDefined();
    process.env.QUESTIONER_ENABLED = 'false';
    expect(questionerEnqueueIfEnabled()).toBeUndefined();
  });
});
