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
