import { createHash } from 'node:crypto';

import { assertAbEnvConfig } from './discovery.flags';
import { DISCOVERY_RUNTIME_REDIS_KEYS, parseDiscoveryRuntimePrerequisites } from './discovery.runtime-prerequisites';

export const HISTORICAL_QUALITY_RUNTIME_CORE_KEYS = [
  'DISCOVERY_TARGETS', 'NEON_API_KEY', 'DISCOVERY_CONFIRM',
  'TEST_DATABASE_SAFE', 'NODE_ENV', 'OPENROUTER_API_KEY',
] as const;

export const HISTORICAL_QUALITY_RUNTIME_MODEL_KEYS = [
  'OPENROUTER_BASE_URL', 'OPENROUTER_REQUEST_TIMEOUT_MS',
  'OPENROUTER_MAX_RETRIES', 'OPENROUTER_FALLBACK_MODEL',
  'OPENROUTER_RUNNABLE_MAX_ATTEMPTS', 'CHAT_MODEL',
  'CHAT_REASONING_EFFORT', 'EMBEDDING_MODEL', 'EMBEDDING_DIMENSIONS',
  'SMARTEST_VERIFIER_MODEL', 'SMARTEST_GENERATOR_MODEL',
  'EVAL_MODEL_OVERRIDES',
] as const;

/** Exact provider runtime used by every historical-quality graph invocation. */
export const HISTORICAL_QUALITY_MODEL_RUNTIME_POLICY = Object.freeze({
  OPENROUTER_BASE_URL: 'https://openrouter.ai/api/v1',
  OPENROUTER_REQUEST_TIMEOUT_MS: '60000',
  OPENROUTER_MAX_RETRIES: '0',
  OPENROUTER_FALLBACK_MODEL: 'none',
  OPENROUTER_RUNNABLE_MAX_ATTEMPTS: '1',
} as const);

const HISTORICAL_QUALITY_DISCOVERY_MODEL_RUNTIME_POLICY = Object.freeze(
  Object.fromEntries(
    Object.entries(HISTORICAL_QUALITY_MODEL_RUNTIME_POLICY)
      .filter(([key]) => key !== 'OPENROUTER_BASE_URL'),
  ) as Readonly<Record<Exclude<keyof typeof HISTORICAL_QUALITY_MODEL_RUNTIME_POLICY, 'OPENROUTER_BASE_URL'>, string>>,
);

export const HISTORICAL_QUALITY_RUNTIME_REDIS_KEYS = DISCOVERY_RUNTIME_REDIS_KEYS;

export const HISTORICAL_QUALITY_MODEL_ASSIGNMENT_CARRIERS = [
  'CHAT_MODEL', 'EVAL_MODEL_OVERRIDES',
] as const;

export type HistoricalQualityRuntimeEnvironment = Readonly<
  Record<(typeof HISTORICAL_QUALITY_RUNTIME_CORE_KEYS)[number], string>
  & Partial<Record<(typeof HISTORICAL_QUALITY_RUNTIME_MODEL_KEYS)[number], string>>
  & (
    | { REDIS_URL: string; REDIS_HOST?: never; REDIS_PORT?: never; REDIS_PASSWORD?: never; REDIS_DB?: never }
    | { REDIS_URL?: never; REDIS_HOST: string; REDIS_PORT: string; REDIS_PASSWORD: string; REDIS_DB: string }
  )
>;

export type HistoricalQualityChildEnvironment = HistoricalQualityRuntimeEnvironment & {
  readonly DISCOVERY_HISTORICAL_QUALITY_CONFIG_JSON: string;
  readonly DISCOVERY_HISTORICAL_QUALITY_CONFIG_FINGERPRINT: string;
};

function required(environment: Readonly<Record<string, string | undefined>>, key: string): string {
  const value = environment[key];
  if (value === undefined || value.trim() === '') throw new Error(`Historical quality runtime requires ${key}`);
  return value;
}

function defined(environment: Readonly<Record<string, string | undefined>>, key: string): string | undefined {
  const value = environment[key];
  return value === undefined || value.trim() === '' ? undefined : value;
}

/** Builds a new minimal runtime object; no caller-owned environment is spread. */
export function parseHistoricalQualityRuntimeEnvironment(
  environment: Readonly<Record<string, string | undefined>>,
): HistoricalQualityRuntimeEnvironment {
  if ('DATABASE_URL' in environment) {
    throw new Error('Historical quality runtime forbids a supplied DATABASE_URL');
  }
  const result: Record<string, string> = {};
  for (const key of HISTORICAL_QUALITY_RUNTIME_CORE_KEYS) {
    if (key !== 'OPENROUTER_API_KEY') result[key] = required(environment, key);
  }
  if (result.DISCOVERY_CONFIRM !== '1') throw new Error('Historical quality DISCOVERY_CONFIRM must equal 1');
  if (result.TEST_DATABASE_SAFE !== '1') throw new Error('Historical quality TEST_DATABASE_SAFE must equal 1');
  const runtimePrerequisites = parseDiscoveryRuntimePrerequisites(environment);
  result.OPENROUTER_API_KEY = runtimePrerequisites.OPENROUTER_API_KEY;
  for (const key of HISTORICAL_QUALITY_RUNTIME_MODEL_KEYS) {
    const value = defined(environment, key);
    if (value !== undefined) result[key] = value;
  }
  Object.assign(result, HISTORICAL_QUALITY_MODEL_RUNTIME_POLICY);

  for (const key of HISTORICAL_QUALITY_RUNTIME_REDIS_KEYS) {
    const value = runtimePrerequisites[key];
    if (value !== undefined) result[key] = value;
  }
  return Object.freeze(result) as HistoricalQualityRuntimeEnvironment;
}

export function normalizeHistoricalQualityDiscoveryConfiguration(
  configuration: Readonly<Record<string, string>>,
): Readonly<Record<string, string>> {
  assertAbEnvConfig(configuration);
  const carriers = new Set<string>(HISTORICAL_QUALITY_MODEL_ASSIGNMENT_CARRIERS);
  return Object.freeze(Object.fromEntries(
    Object.entries({ ...configuration, ...HISTORICAL_QUALITY_DISCOVERY_MODEL_RUNTIME_POLICY })
      .filter(([key]) => !carriers.has(key))
      .sort(([left], [right]) => left.localeCompare(right)),
  ));
}

export function buildHistoricalQualityChildEnvironment(input: {
  parentEnvironment: Readonly<Record<string, string | undefined>>;
  sanitizedConfiguration: Readonly<Record<string, string>>;
}): HistoricalQualityChildEnvironment {
  const runtimeSource: Record<string, string | undefined> = {};
  for (const key of [...HISTORICAL_QUALITY_RUNTIME_CORE_KEYS, ...HISTORICAL_QUALITY_RUNTIME_MODEL_KEYS, ...HISTORICAL_QUALITY_RUNTIME_REDIS_KEYS]) {
    runtimeSource[key] = input.parentEnvironment[key];
  }
  // Model-assignment carriers are effective runtime model inputs, never part of
  // the discovery environment payload applied around the graph.
  for (const key of HISTORICAL_QUALITY_MODEL_ASSIGNMENT_CARRIERS) {
    if (input.sanitizedConfiguration[key] !== undefined) runtimeSource[key] = input.sanitizedConfiguration[key];
  }
  const runtime = parseHistoricalQualityRuntimeEnvironment(runtimeSource);
  const configuration = normalizeHistoricalQualityDiscoveryConfiguration(input.sanitizedConfiguration);
  const configurationJson = JSON.stringify(configuration);
  return Object.freeze({
    ...runtime,
    DISCOVERY_HISTORICAL_QUALITY_CONFIG_JSON: configurationJson,
    DISCOVERY_HISTORICAL_QUALITY_CONFIG_FINGERPRINT: createHash('sha256').update(configurationJson).digest('hex'),
  }) as HistoricalQualityChildEnvironment;
}
