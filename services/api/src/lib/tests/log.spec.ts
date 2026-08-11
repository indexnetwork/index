import { describe, expect, it } from 'bun:test';

import { sanitizeForLog } from '../log';

describe('sanitizeForLog credential redaction', () => {
  it('recursively redacts authorization, code, verifier, and credential-like fields', () => {
    const error = Object.assign(new Error('safe failure'), {
      code: 'authorization-code',
      credentialHash: 'credential-hash',
      safeCount: 3,
    });
    const value = {
      authorization: 'Bearer secret',
      code: 'authorization-code',
      verifier: 'pkce-verifier',
      apiKey: 'api-key',
      nested: {
        credential: 'idxh_secret',
        credentials: [{ secretHash: 'hash', safe: true }],
        headers: { Authorization: 'Bearer nested', 'x-api-key': 'nested-key' },
        error,
      },
    };

    expect(sanitizeForLog(value)).toEqual({
      authorization: '[REDACTED]',
      code: '[REDACTED]',
      verifier: '[REDACTED]',
      apiKey: '[REDACTED]',
      nested: {
        credential: '[REDACTED]',
        credentials: '[REDACTED]',
        headers: { Authorization: '[REDACTED]', 'x-api-key': '[REDACTED]' },
        error: {
          message: 'safe failure',
          name: 'Error',
          code: '[REDACTED]',
          credentialHash: '[REDACTED]',
          safeCount: 3,
        },
      },
    });
  });

  it('redacts bounded mixed-case and separator token variants without broad token matching', () => {
    expect(sanitizeForLog({
      authorizationToken: 'first',
      API_TOKEN: 'second',
      'bearer-token': 'third',
      access_token: 'fourth',
      RefreshToken: 'fifth',
      tokenCount: 5,
      authorizationStatus: 'pending',
      statusCode: 401,
    })).toEqual({
      authorizationToken: '[REDACTED]',
      API_TOKEN: '[REDACTED]',
      'bearer-token': '[REDACTED]',
      access_token: '[REDACTED]',
      RefreshToken: '[REDACTED]',
      tokenCount: 5,
      authorizationStatus: 'pending',
      statusCode: 401,
    });
  });

  it('redacts established project credential prefixes in Error messages and nested cyclic causes', () => {
    const root = new Error('Hermes failed for idxh_ERROR_SECRET while owner used idxo_OWNER_SECRET');
    const cause = new Error('nested idxh_NESTED_SECRET');
    Object.defineProperty(root, 'cause', { value: cause, enumerable: false });
    Object.defineProperty(cause, 'cause', { value: root, enumerable: false });

    const sanitized = sanitizeForLog({ error: root }) as {
      error: { message: string; cause: { message: string; cause: unknown } };
    };
    expect(sanitized.error.message).toBe('Hermes failed for [REDACTED] while owner used [REDACTED]');
    expect(sanitized.error.cause.message).toBe('nested [REDACTED]');
    expect(JSON.stringify(sanitized)).not.toMatch(/idxh_|idxo_|ERROR_SECRET|OWNER_SECRET|NESTED_SECRET/);
  });

  it('redacts established credentials in direct string causes and arbitrary nested string values', () => {
    const error = new Error('safe outer failure', { cause: 'direct idxh_12345678SECRET cause' });
    const cyclic: Record<string, unknown> = {
      detail: 'nested idxo_12345678OWNER value',
      values: ['safe', 'array idxh_12345678ARRAY value'],
      error,
    };
    cyclic.self = cyclic;

    const sanitized = sanitizeForLog(cyclic);
    expect(sanitized).toMatchObject({
      detail: 'nested [REDACTED] value',
      values: ['safe', 'array [REDACTED] value'],
      error: {
        message: 'safe outer failure',
        name: 'Error',
        cause: 'direct [REDACTED] cause',
      },
    });
    expect(JSON.stringify(sanitized)).not.toMatch(/idxh_|idxo_|12345678SECRET|12345678OWNER|12345678ARRAY/);
  });

  it('redacts nested sensitive keys in cyclic plain objects without retaining secrets', () => {
    const cyclic: Record<string, unknown> = {
      label: 'safe',
      nested: { API_TOKEN: 'cycle-secret' },
    };
    cyclic.self = cyclic;
    const sanitized = sanitizeForLog(cyclic);
    expect(JSON.stringify(sanitized)).not.toContain('cycle-secret');
    expect(sanitized).toMatchObject({
      label: 'safe',
      nested: { API_TOKEN: '[REDACTED]' },
    });
  });

  it('preserves unrelated prose and incomplete documented prefixes in errors', () => {
    expect(sanitizeForLog({
      error: new Error('authorization failed; use the idxh_ or idxo_ prefix in documentation'),
    })).toEqual({
      error: {
        message: 'authorization failed; use the idxh_ or idxo_ prefix in documentation',
        name: 'Error',
      },
    });
  });

  it('preserves unrelated truncation and embedding behavior', () => {
    expect(sanitizeForLog({
      statusCode: 401,
      reason: 'expired',
      embedding: [1, 2, 3],
      values: ['safe'],
    })).toEqual({
      statusCode: 401,
      reason: 'expired',
      embedding: '[redacted: 3 values]',
      values: ['safe'],
    });
  });
});
