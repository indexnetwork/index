import { assertPreflightPass, formatPreflightReport, type HermesPreflightReport, type HermesPreflightThresholds } from './hermes-migration-preflight.contract';

export interface HermesPreflightArguments extends HermesPreflightThresholds {
  json: true;
}

function requiredNumber(args: readonly string[], name: '--max-lock-ms' | '--max-total-ms'): number {
  const positions = args.flatMap((value, index) => value === name ? [index] : []);
  if (positions.length === 0) throw new Error(`${name} is required`);
  if (positions.length !== 1) throw new Error(`${name} must be provided exactly once`);
  const raw = args[positions[0]! + 1];
  const value = raw === undefined || raw.trim() === '' ? Number.NaN : Number(raw);
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`${name} must be a non-negative finite number`);
  }
  return value;
}

export function parseHermesPreflightArguments(args: readonly string[]): HermesPreflightArguments {
  if (!args.includes('--json')) throw new Error('--json is required');
  if (args.filter((arg) => arg === '--json').length !== 1) {
    throw new Error('--json must be provided exactly once');
  }
  const allowed = new Set(['--json', '--max-lock-ms', '--max-total-ms']);
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]!;
    if (!allowed.has(arg) && (index === 0 || !['--max-lock-ms', '--max-total-ms'].includes(args[index - 1]!))) {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return {
    json: true,
    maxLockMs: requiredNumber(args, '--max-lock-ms'),
    maxTotalMs: requiredNumber(args, '--max-total-ms'),
  };
}

export async function runHermesPreflightMain(input: {
  args: readonly string[];
  run: () => Promise<HermesPreflightReport>;
  now?: () => number;
  write?: (output: string) => void;
}): Promise<HermesPreflightReport> {
  const options = parseHermesPreflightArguments(input.args);
  const now = input.now ?? (() => performance.now());
  const startedAt = now();
  const report = await input.run();
  const totalDurationMs = Math.max(0, now() - startedAt);
  // Failure reports are evidence too. Emit the same fixed count-only shape
  // before enforcing data and duration gates.
  (input.write ?? console.log)(formatPreflightReport(report));
  assertPreflightPass(report, { ...options, totalDurationMs });
  return report;
}
