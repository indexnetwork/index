export type HermesPreflightThresholds = Readonly<{
  maxLockMs: number;
  maxTotalMs: number;
}>;

type ThresholdEnvironment = Readonly<Record<string, string | undefined>>;

function requirePositiveSafeDecimal(environment: ThresholdEnvironment, name: string): number {
  const raw = environment[name];
  if (raw === undefined || !/^[1-9][0-9]*$/.test(raw)) {
    throw new Error(`${name} must be a required positive decimal integer`);
  }
  const value = Number(raw);
  if (!Number.isSafeInteger(value)) {
    throw new Error(`${name} must be a required positive safe decimal integer`);
  }
  return value;
}

/** Release/operator thresholds are mandatory; this parser intentionally owns no defaults. */
export function requireHermesPreflightThresholds(
  environment: ThresholdEnvironment,
): HermesPreflightThresholds {
  return Object.freeze({
    maxLockMs: requirePositiveSafeDecimal(environment, 'HERMES_PREFLIGHT_MAX_LOCK_MS'),
    maxTotalMs: requirePositiveSafeDecimal(environment, 'HERMES_PREFLIGHT_MAX_TOTAL_MS'),
  });
}
