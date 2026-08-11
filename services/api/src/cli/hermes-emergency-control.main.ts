import { assertEmergencyAudience, assertEmergencyPlanId, formatEmergencyOutput, type EmergencyPlan, type EmergencyReceipt, type HermesEmergencyAudience } from './hermes-emergency-control.contract';

export type HermesEmergencyArguments =
  | { mode: 'plan'; audience: HermesEmergencyAudience }
  | {
    mode: 'execute';
    audience: HermesEmergencyAudience;
    confirm: true;
    planId: string;
    expectedInstallations: number;
  };

function exactFlagValue(args: readonly string[], flag: string): string | undefined {
  const positions = args.flatMap((value, index) => value === flag ? [index] : []);
  if (positions.length > 1) throw new Error(`${flag} must be provided exactly once`);
  if (positions.length === 0) return undefined;
  const value = args[positions[0]! + 1];
  if (value === undefined || value.startsWith('--')) throw new Error(`${flag} requires a value`);
  return value;
}

export function parseHermesEmergencyArguments(args: readonly string[]): HermesEmergencyArguments {
  const valueFlags = new Set(['--audience', '--plan-id', '--expected-installations']);
  const booleanFlags = new Set(['--confirm']);
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]!;
    if (valueFlags.has(arg)) {
      index += 1;
      if (args[index] === undefined || args[index]!.startsWith('--')) throw new Error(`${arg} requires a value`);
      continue;
    }
    if (!booleanFlags.has(arg)) throw new Error('unknown emergency control argument');
  }

  const audience = exactFlagValue(args, '--audience');
  if (audience === undefined) throw new Error('--audience is required');
  assertEmergencyAudience(audience);
  const confirmCount = args.filter((arg) => arg === '--confirm').length;
  if (confirmCount > 1) throw new Error('--confirm must be provided exactly once');
  const planId = exactFlagValue(args, '--plan-id');
  const rawExpectedInstallations = exactFlagValue(args, '--expected-installations');

  if (confirmCount === 0) {
    if (planId !== undefined || rawExpectedInstallations !== undefined) {
      throw new Error('--plan-id and --expected-installations require --confirm');
    }
    return { mode: 'plan', audience };
  }
  if (planId === undefined || rawExpectedInstallations === undefined) {
    throw new Error('--confirm requires --plan-id and --expected-installations');
  }
  assertEmergencyPlanId(planId);
  const expectedInstallations = Number(rawExpectedInstallations);
  if (!Number.isSafeInteger(expectedInstallations) || expectedInstallations < 0) {
    throw new Error('--expected-installations must be a non-negative safe integer');
  }
  return { mode: 'execute', audience, confirm: true, planId, expectedInstallations };
}

export async function runHermesEmergencyMain(input: {
  args: readonly string[];
  plan: (audience: HermesEmergencyAudience) => Promise<EmergencyPlan>;
  execute: (request: {
    audience: HermesEmergencyAudience;
    confirm: true;
    planId: string;
    expectedInstallations: number;
  }) => Promise<EmergencyReceipt>;
  monotonicNow?: () => number;
  write?: (output: string) => void;
}): Promise<EmergencyPlan | EmergencyReceipt> {
  const options = parseHermesEmergencyArguments(input.args);
  const monotonicNow = input.monotonicNow ?? (() => performance.now());
  const startedAt = monotonicNow();
  const result = options.mode === 'plan'
    ? await input.plan(options.audience)
    : await input.execute(options);
  const durationMs = Math.max(0, monotonicNow() - startedAt);
  (input.write ?? console.log)(formatEmergencyOutput({ ...result, durationMs }));
  return result;
}
