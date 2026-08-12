import type { HistoricalQualityChildEnvironment } from './discovery-quality.environment';

export const HISTORICAL_QUALITY_CHILD_RUNTIME_CONTRACT_VERSION = 1 as const;

export interface HistoricalQualityChildRuntime {
  contractVersion: typeof HISTORICAL_QUALITY_CHILD_RUNTIME_CONTRACT_VERSION;
  preflightHistoricalQualityChildRuntime(environment: Readonly<Record<string, string | undefined>>): Promise<void>;
  runHistoricalQualityChild(
    args: readonly string[],
    environment: HistoricalQualityChildEnvironment,
  ): Promise<void>;
}

const CHILD_RUNTIME_SPECIFIER = './discovery-quality.child';

/**
 * Loads the real child implementation and invokes its own preflight contract.
 * There is deliberately no fallback module: until Task 6 supplies this exact
 * export surface, both parent and direct-child entry points refuse.
 */
export async function loadAvailableHistoricalQualityChildRuntime(
  environment: Readonly<Record<string, string | undefined>>,
): Promise<HistoricalQualityChildRuntime> {
  let candidate: Partial<HistoricalQualityChildRuntime>;
  try {
    candidate = await import(CHILD_RUNTIME_SPECIFIER) as Partial<HistoricalQualityChildRuntime>;
  } catch {
    throw new Error('Historical quality child runtime is unavailable');
  }
  if (candidate.contractVersion !== HISTORICAL_QUALITY_CHILD_RUNTIME_CONTRACT_VERSION
    || typeof candidate.preflightHistoricalQualityChildRuntime !== 'function'
    || typeof candidate.runHistoricalQualityChild !== 'function') {
    throw new Error('Historical quality child runtime is unavailable');
  }
  const runtime = candidate as HistoricalQualityChildRuntime;
  await runtime.preflightHistoricalQualityChildRuntime(environment);
  return runtime;
}

export async function preflightHistoricalQualityChildRuntime(
  environment: Readonly<Record<string, string | undefined>> = process.env,
): Promise<void> {
  await loadAvailableHistoricalQualityChildRuntime(environment);
}
