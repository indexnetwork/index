import { afterAll, describe, expect, it, mock } from 'bun:test';

const calls: Array<{ method: string; args: unknown[] }> = [];
const priorNodeEnv = process.env.NODE_ENV;
process.env.NODE_ENV = 'production';
mock.module('@sentry/bun', () => ({
  metrics: {
    count: (...args: unknown[]) => calls.push({ method: 'count', args }),
    gauge: (...args: unknown[]) => calls.push({ method: 'gauge', args }),
    distribution: (...args: unknown[]) => calls.push({ method: 'distribution', args }),
  },
  logger: {
    trace: (...args: unknown[]) => calls.push({ method: 'log.trace', args }),
    debug: (...args: unknown[]) => calls.push({ method: 'log.debug', args }),
    info: (...args: unknown[]) => calls.push({ method: 'log.info', args }),
    warn: (...args: unknown[]) => calls.push({ method: 'log.warn', args }),
    error: (...args: unknown[]) => calls.push({ method: 'log.error', args }),
  },
}));

const { HermesRuntimeTelemetry } = await import('../hermes-runtime-telemetry');
const { logNegotiationPickupConflict } = await import('../negotiation-polling.log');

afterAll(() => {
  process.env.NODE_ENV = priorNodeEnv;
  mock.restore();
});

describe('Hermes Sentry telemetry sink in a fresh process', () => {
  it('forwards only validated bounded metrics to the production sink shape', () => {
    const telemetry = new HermesRuntimeTelemetry();
    telemetry.increment('credential_rejected', { reason: 'expired' });
    telemetry.gauge('credentials_expired', 2);
    telemetry.observe('advisory_lock_wait_ms', 12.5);

    expect(calls).toEqual([
      { method: 'count', args: ['hermes.credential_rejected', 1, { attributes: { reason: 'expired' } }] },
      { method: 'gauge', args: ['hermes.credentials_expired', 2] },
      { method: 'distribution', args: ['hermes.advisory_lock_wait_ms', 12.5, { unit: 'millisecond' }] },
    ]);

    const secret = 'idxh_must-not-reach-sentry';
    expect(() => telemetry.increment('auth_denied', { ownerId: secret } as never)).toThrow();
    expect(JSON.stringify(calls)).not.toContain(secret);
  });

  it('forwards the negotiation conflict application log with only its stable reason', () => {
    logNegotiationPickupConflict();

    const applicationLog = calls.find(({ method }) => method === 'log.info');
    expect(applicationLog).toEqual({
      method: 'log.info',
      args: [
        'Lost race to claim negotiation task',
        {
          service: 'backend',
          log_context: 'service',
          log_source: 'NegotiationPollingService',
          'meta.reason': 'runtime_conflict',
        },
      ],
    });
    const serialized = JSON.stringify(applicationLog);
    expect(serialized).toContain('runtime_conflict');
    expect(serialized).not.toMatch(/agentId|userId|ownerId|credential|installationId|idxh_|idxo_/);
  });
});
