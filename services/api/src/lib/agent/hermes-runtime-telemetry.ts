import * as Sentry from '@sentry/bun';

export const HERMES_TELEMETRY_EVENTS = [
  'authorization_started',
  'authorization_completed',
  'authorization_expired',
  'authorization_replayed',
  'credential_rejected',
  'credential_rotated',
  'credential_revoked',
  'credential_revocation_pending',
  'runtime_stale',
  'index_fallback',
  'auth_denied',
  'conflict',
  'server_error',
  'outbox_replay_attempted',
] as const;

export const HERMES_TELEMETRY_GAUGES = [
  'credentials_near_expiry',
  'credentials_expired',
  'pending_outbox',
] as const;

export const HERMES_TELEMETRY_OBSERVATIONS = [
  'advisory_lock_wait_ms',
] as const;

export const HERMES_TELEMETRY_REASONS = [
  'expired',
  'replayed',
  'invalid_credential',
  'missing_credential',
  'malformed_credential',
  'revoked',
  'invalid_grant',
  'authorization_conflict',
  'runtime_conflict',
  'runtime_not_found',
  'stale',
  'never_seen',
  'run_exhausted',
  'outbox_pending',
  'outbox_delivery',
  'server_error',
] as const;

export type HermesTelemetryEvent = typeof HERMES_TELEMETRY_EVENTS[number];
export type HermesTelemetryGauge = typeof HERMES_TELEMETRY_GAUGES[number];
export type HermesTelemetryObservation = typeof HERMES_TELEMETRY_OBSERVATIONS[number];
export type HermesTelemetryReason = typeof HERMES_TELEMETRY_REASONS[number];

/** The only supported label is a bounded reason enum. */
export type HermesTelemetryAttributes = Readonly<{
  reason?: HermesTelemetryReason;
}>;

/** Synchronous sink boundary; callers never wait on external telemetry. */
export interface HermesRuntimeTelemetrySink {
  increment(name: string, attributes: Record<string, string>): void;
  gauge(name: string, value: number): void;
  observe(name: string, milliseconds: number): void;
}

const EVENTS = new Set<string>(HERMES_TELEMETRY_EVENTS);
const GAUGES = new Set<string>(HERMES_TELEMETRY_GAUGES);
const OBSERVATIONS = new Set<string>(HERMES_TELEMETRY_OBSERVATIONS);
const REASONS = new Set<string>(HERMES_TELEMETRY_REASONS);

const sentrySink: HermesRuntimeTelemetrySink = {
  increment(name, attributes) {
    Sentry.metrics.count(name, 1, { attributes });
  },
  gauge(name, value) {
    Sentry.metrics.gauge(name, value);
  },
  observe(name, milliseconds) {
    Sentry.metrics.distribution(name, milliseconds, { unit: 'millisecond' });
  },
};

function assertMetricName(allowed: ReadonlySet<string>, name: string): void {
  if (!allowed.has(name)) throw new TypeError('Invalid Hermes telemetry name');
}

function assertNumericValue(value: number): void {
  if (!Number.isFinite(value) || value < 0) {
    throw new TypeError('Invalid Hermes telemetry numeric value');
  }
}

function validatedAttributes(attributes: HermesTelemetryAttributes | undefined): Record<string, string> {
  if (attributes === undefined) return {};
  if (!attributes || typeof attributes !== 'object' || Array.isArray(attributes)) {
    throw new TypeError('Invalid Hermes telemetry attributes');
  }
  const entries = Object.entries(attributes);
  if (entries.some(([key]) => key !== 'reason')) {
    throw new TypeError('Invalid Hermes telemetry attributes');
  }
  if (attributes.reason === undefined) return {};
  if (!REASONS.has(attributes.reason)) {
    throw new TypeError('Invalid Hermes telemetry reason');
  }
  return { reason: attributes.reason };
}

/**
 * Privacy-bounded Hermes metrics. Validation happens before the sink boundary;
 * sink failures are isolated from authority and transaction behavior.
 */
export class HermesRuntimeTelemetry {
  constructor(private readonly sink: HermesRuntimeTelemetrySink = sentrySink) {}

  increment<T extends HermesTelemetryAttributes = HermesTelemetryAttributes>(
    event: HermesTelemetryEvent,
    attributes?: T & Record<Exclude<keyof T, keyof HermesTelemetryAttributes>, never>,
  ): void {
    assertMetricName(EVENTS, event);
    const safeAttributes = validatedAttributes(attributes);
    try {
      this.sink.increment(`hermes.${event}`, safeAttributes);
    } catch {
      // Observability must never alter authority behavior.
    }
  }

  gauge(name: HermesTelemetryGauge, value: number): void {
    assertMetricName(GAUGES, name);
    assertNumericValue(value);
    try {
      this.sink.gauge(`hermes.${name}`, value);
    } catch {
      // Observability must never alter authority behavior.
    }
  }

  observe(name: HermesTelemetryObservation, milliseconds: number): void {
    assertMetricName(OBSERVATIONS, name);
    assertNumericValue(milliseconds);
    try {
      this.sink.observe(`hermes.${name}`, milliseconds);
    } catch {
      // Observability must never alter authority behavior.
    }
  }
}

export const hermesRuntimeTelemetry = new HermesRuntimeTelemetry();

/** Time only the database lock acquisition; telemetry remains synchronous and unlabeled. */
export async function observeHermesAdvisoryLockWait(
  telemetry: HermesRuntimeTelemetry,
  acquire: () => Promise<unknown>,
  now: () => number = () => performance.now(),
): Promise<void> {
  const startedAt = now();
  try {
    await acquire();
  } finally {
    telemetry.observe('advisory_lock_wait_ms', Math.max(0, now() - startedAt));
  }
}
