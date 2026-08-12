/**
 * Provider- and infrastructure-free PR A contract for the historical quality
 * pilot. Its sole import is the pure discovery configuration authority, so the
 * bootstrap can validate, explain, cost, and refuse before entering the legacy gate.
 */
import { assertAbEnvConfig } from './discovery.flags';

export const HISTORICAL_QUALITY_APPROVED_CASE_IDS = Object.freeze([
  'historical/builder-and-operator',
  'historical/co-researchers-structure',
  'historical/songwriting-duo',
  'historical/first-check-investor',
  'historical/domain-expert-and-ml',
] as const);

/** Exact fingerprints admitted by independent approval at 0ee612602. */
export const HISTORICAL_QUALITY_APPROVED_FINGERPRINTS = Object.freeze({
  corpusVersion: 'historical-shared-pool-v1',
  planFingerprint: '288336f6511a366d8d49303bc3e76eb475a981966e1ffb0eb2a8539d53fc4ce6',
  seedProjectionFingerprint: '8d27a7634c7def4857f5acd5b399ee82389d8c9baab23fe0b8b4df187a337c38',
  retrievalDocumentFingerprint: '87142f9c46d5fa51f6327c169f6c25d0d90fe35def5ed8778cd27e3da98d7b35',
});

export const HISTORICAL_QUALITY_DEFAULT_REPETITIONS = 3;
export const HISTORICAL_QUALITY_MAX_GRAPH_INVOCATIONS = 200;
export type HistoricalQualityTrigger = 'intent' | 'enrichment';
export interface HistoricalQualityRequest {
  caseIds: string[];
  triggers: HistoricalQualityTrigger[];
  repetitions: number;
  configuration: { id: 'a'; config: Record<string, string> };
  reportPath?: string;
  force: boolean;
}

export interface HistoricalQualityCost {
  graphInvocations: number;
  evaluatorCalls: number;
}

/** Quality slots require one bundled evaluator call so one slot has one known cost. */
export function assertHistoricalQualitySerialEvaluation(config: Readonly<Record<string, string>>): void {
  if (config.RUN_OPPORTUNITY_EVAL_IN_PARALLEL === 'true') {
    throw new Error('Historical quality refuses parallel opportunity evaluation; one bundled evaluator call is required per slot');
  }
}

const VALUE_FLAGS = new Set(['--case', '--trigger', '--runs', '--env', '--report']);
const BASELINE_FLAGS = new Set(['--update-baseline', '--baseline', '--rolling-baseline']);
const ENV_ASSIGNMENT = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/;

function valuesFor(args: readonly string[], flag: string): string[] {
  const values: string[] = [];
  for (const [index, value] of args.entries()) {
    if (value !== flag) continue;
    const next = args[index + 1];
    if (next === undefined || next.startsWith('-')) throw new Error(`${flag} requires a value`);
    values.push(next);
  }
  return values;
}

function assertKnownHistoricalQualityArgs(args: readonly string[]): void {
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]!;
    if (VALUE_FLAGS.has(arg)) {
      const next = args[index + 1];
      if (next === undefined || next.startsWith('-')) throw new Error(`${arg} requires a value`);
      index += 1;
      continue;
    }
    if (arg === '--historical-quality' || arg === '--force' || arg === '--help' || arg === '-h') continue;
    if (BASELINE_FLAGS.has(arg)) {
      throw new Error('Historical quality does not read, write, or update a baseline');
    }
    if (arg === '--a' || arg === '--b') {
      throw new Error('Historical quality does not accept --a or --b comparison inputs; use exactly one --env');
    }
    throw new Error(`Unknown historical quality flag: ${arg}`);
  }
}

export function isHistoricalQualityRequest(args: readonly string[]): boolean {
  return args.includes('--historical-quality');
}

export function hasHistoricalQualityHelp(args: readonly string[]): boolean {
  return args.includes('--help') || args.includes('-h');
}

export function historicalQualityCost(request: HistoricalQualityRequest): HistoricalQualityCost {
  const graphInvocations = request.caseIds.length * request.triggers.length * request.repetitions;
  return { graphInvocations, evaluatorCalls: graphInvocations };
}

export function parseHistoricalQualityArgs(args: readonly string[]): HistoricalQualityRequest {
  assertKnownHistoricalQualityArgs(args);
  if (!isHistoricalQualityRequest(args)) throw new Error('--historical-quality is required');
  if (args.filter((arg) => arg === '--historical-quality').length !== 1) {
    throw new Error('--historical-quality may be given exactly once');
  }

  const selectedCases = valuesFor(args, '--case');
  if (new Set(selectedCases).size !== selectedCases.length) throw new Error('--case names the same case twice');
  for (const caseId of selectedCases) {
    if (!(HISTORICAL_QUALITY_APPROVED_CASE_IDS as readonly string[]).includes(caseId)) {
      throw new Error(`${caseId} is not an approved historical quality case`);
    }
  }
  const caseIds = selectedCases.length === 0 ? [...HISTORICAL_QUALITY_APPROVED_CASE_IDS] : selectedCases;

  const selectedTriggers = valuesFor(args, '--trigger');
  if (new Set(selectedTriggers).size !== selectedTriggers.length) throw new Error('--trigger names the same trigger twice');
  for (const trigger of selectedTriggers) {
    if (trigger !== 'intent' && trigger !== 'enrichment') {
      throw new Error(`--trigger must be intent or enrichment (received ${trigger})`);
    }
  }
  const triggers: HistoricalQualityTrigger[] = selectedTriggers.length === 0
    ? ['intent', 'enrichment']
    : selectedTriggers as HistoricalQualityTrigger[];

  const runs = valuesFor(args, '--runs');
  if (runs.length > 1) throw new Error('--runs may be given at most once');
  const rawRuns = runs[0];
  if (rawRuns !== undefined && !/^[1-9]\d*$/.test(rawRuns)) {
    throw new Error(`--runs must be a positive integer (received ${rawRuns})`);
  }
  const repetitions = rawRuns === undefined ? HISTORICAL_QUALITY_DEFAULT_REPETITIONS : Number(rawRuns);

  const environments = valuesFor(args, '--env');
  if (environments.length === 0) throw new Error('Historical quality --env KEY=VALUE is required');
  if (environments.length !== 1) throw new Error('Historical quality accepts exactly one --env KEY=VALUE');
  const assignment = ENV_ASSIGNMENT.exec(environments[0]!);
  if (!assignment) throw new Error(`--env expects KEY=VALUE (received ${environments[0]})`);
  const [, key, value] = assignment as unknown as [string, string, string];
  assertAbEnvConfig({ [key]: value });

  const reports = valuesFor(args, '--report');
  if (reports.length > 1) throw new Error('--report may be given at most once');
  if (reports[0] !== undefined && reports[0]!.trim() === '') throw new Error('--report requires a value');

  const request: HistoricalQualityRequest = {
    caseIds,
    triggers,
    repetitions,
    configuration: { id: 'a', config: Object.fromEntries([[key, value]]) },
    ...(reports[0] === undefined ? {} : { reportPath: reports[0] }),
    force: args.includes('--force'),
  };
  const { graphInvocations } = historicalQualityCost(request);
  if (graphInvocations > HISTORICAL_QUALITY_MAX_GRAPH_INVOCATIONS) {
    throw new Error(`${graphInvocations} graph invocations exceeds hard cap ${HISTORICAL_QUALITY_MAX_GRAPH_INVOCATIONS}`);
  }
  return request;
}

export function formatHistoricalQualityCost(request: HistoricalQualityRequest): string {
  const { graphInvocations, evaluatorCalls } = historicalQualityCost(request);
  const repetitions = request.repetitions === 1 ? '1 repetition' : `${request.repetitions} repetitions`;
  return [
    `Historical quality cost: ${request.caseIds.length} cases x ${request.triggers.length} triggers x ${repetitions} = ${graphInvocations} graph invocations and ${evaluatorCalls} evaluator calls.`,
    'Execution policy: restore before every slot; one attempt and one evaluator call per slot.',
    'Verdict policy: a case or trigger subset produces evidence only; no subset verdict.',
    'Safety order: attest topology; verify the protected base read-only; then restore side a before each serial slot.',
  ].join('\n');
}

export function historicalQualityUsage(): string {
  return [
    'Discovery historical quality pilot',
    '',
    '  --historical-quality  Select the dedicated one-configuration quality pilot.',
    '  --case <id>           Select an approved historical case. Repeatable; default: all five.',
    '  --trigger <kind>      intent or enrichment. Repeatable; default: both.',
    `  --runs <n>            Repetitions (default ${HISTORICAL_QUALITY_DEFAULT_REPETITIONS}; maximum 200 total graph invocations).`,
    '  --env KEY=VALUE       The single side-a configuration. Exactly one is required.',
    '  --report <path>       Use the existing report destination convention.',
    '  --force               Use the existing report replacement consent convention.',
    '',
    'A full one-repetition pilot is 5 cases x 2 triggers = 10 graph invocations and 10 evaluator calls.',
    'The default is 5 cases x 2 triggers x 3 repetitions = 30 graph invocations and 30 evaluator calls.',
    'Execution will restore before every slot and permits one attempt and one evaluator call per slot.',
    'A case or trigger subset produces evidence only; there is no subset verdict.',
    'The parent attests topology and verifies the protected base read-only before the first restore.',
  ].join('\n');
}
