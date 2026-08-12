/** Provider and cache prerequisites shared by discovery runtime entry points. */
export const DISCOVERY_RUNTIME_REDIS_KEYS = [
  'REDIS_URL', 'REDIS_HOST', 'REDIS_PORT', 'REDIS_PASSWORD', 'REDIS_DB',
] as const;

const DISCOVERY_RUNTIME_REDIS_SPLIT_KEYS = DISCOVERY_RUNTIME_REDIS_KEYS.slice(1);

export type DiscoveryRuntimePrerequisites = Readonly<{
  OPENROUTER_API_KEY: string;
} & (
  | { REDIS_URL: string; REDIS_HOST?: never; REDIS_PORT?: never; REDIS_PASSWORD?: never; REDIS_DB?: never }
  | { REDIS_URL?: never; REDIS_HOST: string; REDIS_PORT: string; REDIS_PASSWORD: string; REDIS_DB: string }
)>;

/** A fixed, value-free runtime prerequisite refusal safe to show to operators. */
export class DiscoveryRuntimePrerequisiteError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DiscoveryRuntimePrerequisiteError';
  }
}

function nonblank(
  environment: Readonly<Record<string, string | undefined>>,
  key: string,
): string | undefined {
  const value = environment[key];
  return value === undefined || value.trim() === '' ? undefined : value;
}

/**
 * Reads no files and contacts no services. It accepts exactly the two Redis
 * forms supported by the historical-quality production runtime.
 */
export function parseDiscoveryRuntimePrerequisites(
  environment: Readonly<Record<string, string | undefined>>,
): DiscoveryRuntimePrerequisites {
  const providerKey = nonblank(environment, 'OPENROUTER_API_KEY');
  if (providerKey === undefined) {
    throw new DiscoveryRuntimePrerequisiteError('Discovery runtime requires OPENROUTER_API_KEY');
  }

  const redisUrl = nonblank(environment, 'REDIS_URL');
  const splitValues = DISCOVERY_RUNTIME_REDIS_SPLIT_KEYS.map((key) => nonblank(environment, key));
  const hasSplit = splitValues.some((value) => value !== undefined);
  if ((redisUrl !== undefined && hasSplit) || (redisUrl === undefined && !hasSplit)) {
    throw new DiscoveryRuntimePrerequisiteError(
      'Discovery runtime requires exactly one Redis configuration: REDIS_URL or REDIS_HOST/REDIS_PORT/REDIS_PASSWORD/REDIS_DB',
    );
  }
  if (redisUrl !== undefined) {
    return Object.freeze({ OPENROUTER_API_KEY: providerKey, REDIS_URL: redisUrl });
  }
  if (splitValues.some((value) => value === undefined)) {
    throw new DiscoveryRuntimePrerequisiteError(
      'Discovery runtime requires the complete REDIS_HOST/REDIS_PORT/REDIS_PASSWORD/REDIS_DB form',
    );
  }
  return Object.freeze({
    OPENROUTER_API_KEY: providerKey,
    REDIS_HOST: splitValues[0]!,
    REDIS_PORT: splitValues[1]!,
    REDIS_PASSWORD: splitValues[2]!,
    REDIS_DB: splitValues[3]!,
  });
}
