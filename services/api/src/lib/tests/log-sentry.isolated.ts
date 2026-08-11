import { afterAll, describe, expect, it, mock, spyOn } from 'bun:test';

const captured: Array<Record<string, unknown>> = [];
const capture = (_message: string, attributes: Record<string, unknown>) => captured.push(attributes);
mock.module('@sentry/bun', () => ({
  logger: { trace: capture, debug: capture, info: capture, warn: capture, error: capture },
}));

const priorNodeEnv = process.env.NODE_ENV;
process.env.NODE_ENV = 'production';
const { log } = await import('../log');

afterAll(() => {
  process.env.NODE_ENV = priorNodeEnv;
  mock.restore();
});

describe('Sentry log metadata redaction', () => {
  it('redacts every sensitive top-level key before Sentry attribute conversion', () => {
    const consoleInfo = spyOn(console, 'info').mockImplementation(() => undefined);
    const sensitiveKeys = [
      'authorization', 'Authorization-Header', 'code', 'authorization_code',
      'verifier', 'code-verifier', 'apiKey', 'x-api-key', 'secret', 'secret_hash',
      'password', 'accessToken', 'refresh_token', 'authorizationToken', 'api_token',
      'bearerToken', 'credential', 'credentials', 'credentialId', 'credential_hash',
      'clientSecret',
    ];
    const metadata = Object.fromEntries(sensitiveKeys.map((key) => [key, `idxh_${key}_SECRET`]));
    metadata.safeCount = 7;
    metadata.safeReason = 'expired';

    try {
      log.lib.from('sentry-redaction-test').info('safe message', metadata);
    } finally {
      consoleInfo.mockRestore();
    }

    expect(captured).toHaveLength(1);
    const attributes = captured[0]!;
    for (const key of sensitiveKeys) {
      const normalized = key.replace(/[^a-zA-Z0-9_.-]/g, '_');
      expect(attributes[`meta.${normalized}`], key).toBe('[REDACTED]');
    }
    expect(attributes['meta.safeCount']).toBe(7);
    expect(attributes['meta.safeReason']).toBe('expired');
    expect(JSON.stringify(attributes)).not.toContain('_SECRET');
  });
});
