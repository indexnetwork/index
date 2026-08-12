import { describe, expect, it } from 'bun:test';

import { HERMES_TELEMETRY_EVENTS, HERMES_TELEMETRY_GAUGES, HERMES_TELEMETRY_OBSERVATIONS, HermesRuntimeTelemetry, observeHermesAdvisoryLockWait, type HermesRuntimeTelemetrySink } from '../hermes-runtime-telemetry';

function recordingSink() {
  const events: Array<{ name: string; attributes: Record<string, string> }> = [];
  const gauges: Array<{ name: string; value: number }> = [];
  const observations: Array<{ name: string; milliseconds: number }> = [];
  const sink: HermesRuntimeTelemetrySink = {
    increment: (name, attributes) => events.push({ name, attributes }),
    gauge: (name, value) => gauges.push({ name, value }),
    observe: (name, milliseconds) => observations.push({ name, milliseconds }),
  };
  return { sink, events, gauges, observations };
}

describe('HermesRuntimeTelemetry', () => {
  it('emits only prefixed enumerated metrics with stable reasons and numeric values', () => {
    const recorded = recordingSink();
    const telemetry = new HermesRuntimeTelemetry(recorded.sink);

    telemetry.increment('credential_rejected', { reason: 'expired' });
    telemetry.gauge('credentials_near_expiry', 2);
    telemetry.observe('advisory_lock_wait_ms', 12.5);

    expect(recorded.events).toEqual([
      { name: 'hermes.credential_rejected', attributes: { reason: 'expired' } },
    ]);
    expect(recorded.gauges).toEqual([
      { name: 'hermes.credentials_near_expiry', value: 2 },
    ]);
    expect(recorded.observations).toEqual([
      { name: 'hermes.advisory_lock_wait_ms', milliseconds: 12.5 },
    ]);
    expect(HERMES_TELEMETRY_EVENTS).toEqual([
      'authorization_started', 'authorization_completed', 'authorization_expired',
      'authorization_replayed', 'credential_rejected', 'credential_rotated',
      'credential_revoked', 'credential_revocation_pending', 'runtime_stale',
      'index_fallback', 'auth_denied', 'conflict', 'server_error',
      'outbox_replay_attempted',
    ]);
    expect(HERMES_TELEMETRY_GAUGES).toEqual([
      'credentials_near_expiry', 'credentials_expired', 'pending_outbox',
    ]);
    expect(HERMES_TELEMETRY_OBSERVATIONS).toEqual(['advisory_lock_wait_ms']);
  });

  it('rejects unknown names, dimensions, reasons, and non-finite or negative values without echoing input', () => {
    const telemetry = new HermesRuntimeTelemetry(recordingSink().sink);
    const secret = 'idxh_must-not-appear';
    const prohibitedDimensions = [
      'ownerId', 'userId', 'agentId', 'installationId', 'credentialId',
      'requestId', 'code', 'verifier', 'apiKey', 'negotiationId', 'runId',
      'capability', 'message', 'freeText',
    ];
    const attempts: Array<() => void> = [
      () => telemetry.increment('not-enumerated' as never),
      ...prohibitedDimensions.map((dimension) => () => telemetry.increment(
        'credential_rejected',
        { [dimension]: secret } as never,
      )),
      () => telemetry.increment('credential_rejected', { reason: secret } as never),
      () => telemetry.increment('auth_denied', { ...{ reason: 'expired' }, ownerId: secret } as never),
      () => telemetry.gauge('pending_outbox', Number.NaN),
      () => telemetry.gauge('pending_outbox', -1),
      () => telemetry.observe('advisory_lock_wait_ms', Number.POSITIVE_INFINITY),
    ];

    for (const attempt of attempts) {
      expect(attempt).toThrow();
      try {
        attempt();
      } catch (error) {
        expect(String(error)).not.toContain(secret);
      }
    }
  });

  it('observes advisory-lock wait without labels and preserves acquisition failures', async () => {
    const recorded = recordingSink();
    const telemetry = new HermesRuntimeTelemetry(recorded.sink);
    const ticks = [100, 112.5, 200, 207];
    const now = () => ticks.shift()!;

    await expect(observeHermesAdvisoryLockWait(
      telemetry,
      async () => undefined,
      now,
    )).resolves.toBeUndefined();
    const failure = new Error('lock acquisition failed');
    await expect(observeHermesAdvisoryLockWait(
      telemetry,
      async () => { throw failure; },
      now,
    )).rejects.toBe(failure);

    expect(recorded.observations).toEqual([
      { name: 'hermes.advisory_lock_wait_ms', milliseconds: 12.5 },
      { name: 'hermes.advisory_lock_wait_ms', milliseconds: 7 },
    ]);
  });

  it('suppresses sink failures without changing the caller path', () => {
    const failure = () => { throw new Error('external sink failed'); };
    const telemetry = new HermesRuntimeTelemetry({
      increment: failure,
      gauge: failure,
      observe: failure,
    });

    expect(() => telemetry.increment('authorization_started')).not.toThrow();
    expect(() => telemetry.gauge('pending_outbox', 0)).not.toThrow();
    expect(() => telemetry.observe('advisory_lock_wait_ms', 0)).not.toThrow();
  });

  it('rejects sensitive and free-text dimensions at compile time', () => {
    const telemetry = new HermesRuntimeTelemetry(recordingSink().sink);
    const compileTimeAssertions = () => {
      // @ts-expect-error owner identifiers are not telemetry dimensions
      telemetry.increment('auth_denied', { ownerId: 'owner' });
      // @ts-expect-error credential identifiers are not telemetry dimensions
      telemetry.increment('auth_denied', { credentialId: 'credential' });
      // @ts-expect-error request identifiers are not telemetry dimensions
      telemetry.increment('auth_denied', { requestId: 'request' });
      // @ts-expect-error API keys are not telemetry dimensions
      telemetry.increment('auth_denied', { apiKey: 'secret' });
      // @ts-expect-error user identifiers are not telemetry dimensions
      telemetry.increment('auth_denied', { userId: 'user' });
      // @ts-expect-error agent identifiers are not telemetry dimensions
      telemetry.increment('auth_denied', { agentId: 'agent' });
      // @ts-expect-error installation identifiers are not telemetry dimensions
      telemetry.increment('auth_denied', { installationId: 'installation' });
      // @ts-expect-error codes are not telemetry dimensions
      telemetry.increment('auth_denied', { code: 'code' });
      // @ts-expect-error verifiers are not telemetry dimensions
      telemetry.increment('auth_denied', { verifier: 'verifier' });
      // @ts-expect-error negotiation identifiers are not telemetry dimensions
      telemetry.increment('auth_denied', { negotiationId: 'negotiation' });
      // @ts-expect-error run identifiers are not telemetry dimensions
      telemetry.increment('auth_denied', { runId: 'run' });
      // @ts-expect-error capabilities are not telemetry dimensions
      telemetry.increment('auth_denied', { capability: 'capability' });
      // @ts-expect-error arbitrary prose is not a telemetry dimension
      telemetry.increment('auth_denied', { message: 'free text' });
      // @ts-expect-error arbitrary free text is not a telemetry dimension
      telemetry.increment('auth_denied', { freeText: 'free text' });
      const aliased = { reason: 'expired' as const, ownerId: 'owner' };
      // @ts-expect-error aliased objects retain exact-key enforcement
      telemetry.increment('auth_denied', aliased);
      const spread = { ...{ reason: 'expired' as const }, agentId: 'agent' };
      // @ts-expect-error spread objects retain exact-key enforcement
      telemetry.increment('auth_denied', spread);
    };
    expect(compileTimeAssertions).toBeFunction();
  });
});
