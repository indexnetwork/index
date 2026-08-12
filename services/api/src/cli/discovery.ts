#!/usr/bin/env bun
/**
 * Dependency-free attesting bootstrap for the discovery harness.
 *
 * The property this file exists to preserve is an ordering one: the gate is
 * checked and both Neon targets are attested *before* anything that could
 * compose a database singleton is imported. `discovery.main.ts` reaches
 * `@indexnetwork/protocol` through its very first import, so importing it
 * eagerly here would load the graph before the branches were proven. Every
 * import above is either `node:`-free control-plane code or the pure gate.
 *
 * Mirrors `discovery-env-matrix.ts`, with one difference: the A/B manifest
 * carries the same fields for parent and child, so there is no separate
 * attested projection to hand down — the child re-parses `DISCOVERY_TARGETS`
 * and checks its own `DATABASE_URL` against it.
 *
 * `--help` is answered above all of it, from `discovery.contract.ts`, which
 * imports nothing that can compose a database: an operator has to be able to
 * read what the command requires *before* they have any of it.
 */
import { AB_BRANCH_NAMES, attestAbTargets, parseLegacyAbManifest, type AbManifest } from './discovery.neon';
import { AB_SIDE_BRANCH_ENV, assertAbConfirmation, assertAbRuntimePrerequisites } from './discovery.gate';
import { abAttestationRefusal, abUsage, describeAbFailure, type AbInvocationRole } from './discovery.contract';
import { createNeonControlPlane } from './discovery-env-matrix.neon';
import { formatHistoricalQualityCost, hasHistoricalQualityHelp, historicalQualityUsage, isHistoricalQualityRequest, parseHistoricalQualityArgs, type HistoricalQualityRequest } from './discovery-quality.contract';

import type { AbSideId } from './discovery.plan';
import type { HistoricalQualityChildEnvironment } from './discovery-quality.environment';

/**
 * Attests both targets, reporting a refusal an operator can act on without
 * echoing anything the control plane said.
 *
 * The refusal itself is authored in `discovery.contract.ts`, per role: the
 * same attestation runs in the parent and in every child, and a child is
 * attesting *after* the parent already reset this run's target branches and spawned it, so
 * the two cannot truthfully say the same thing about cost.
 */
async function attestOrRefuse(manifest: AbManifest, role: AbInvocationRole): Promise<void> {
  try {
    await attestAbTargets({ manifest, controlPlane: createNeonControlPlane(process.env.NEON_API_KEY ?? '') });
  } catch (error) {
    throw abAttestationRefusal(role, { cause: error });
  }
}

/**
 * Parent or child, decided by the presence of `--side` alone.
 *
 * Deliberately not `childSideId`: a malformed `--side` value still names a
 * child invocation, and reporting one as a parent would print a run-level cost
 * claim from a process that has no idea what the run cost.
 */
function abInvocationRole(args: readonly string[]): AbInvocationRole {
  return args.includes('--side') ? 'child' : 'parent';
}

/** The side this process runs, or undefined for the parent invocation. */
function childSideId(args: readonly string[]): AbSideId | undefined {
  const index = args.indexOf('--side');
  if (index === -1) return undefined;
  const side = args[index + 1];
  // Anything malformed is left to `parseAbChildArgs`, which owns that contract
  // and refuses it by name; this only decides whether a child is being asked for.
  return side === 'a' || side === 'b' ? side : undefined;
}

interface DiscoveryRuntime {
  main(args: readonly string[]): Promise<void>;
}

/**
 * The complete provider-facing boundary below quality argument handling.
 * Production supplies the existing legacy operations; tests can instrument the
 * same boundary without importing or composing the runtime.
 */
export interface DiscoveryBootstrapDependencies {
  assertConfirmation(env: NodeJS.ProcessEnv): void;
  assertRuntimePrerequisites(env: NodeJS.ProcessEnv): void;
  parseManifest(raw: string | undefined): AbManifest;
  attestTargets(manifest: AbManifest, role: AbInvocationRole): Promise<void>;
  importRuntime(): Promise<DiscoveryRuntime>;
  importQualityRuntime?(): Promise<{
    runHistoricalQualityRuntime(request: HistoricalQualityRequest): Promise<unknown>;
  }>;
  importQualityChildRuntime?(environment: Readonly<Record<string, string | undefined>>): Promise<{
    runHistoricalQualityChild(args: readonly string[], environment: HistoricalQualityChildEnvironment): Promise<void>;
  }>;
}

const productionBootstrapDependencies: DiscoveryBootstrapDependencies = {
  assertConfirmation: assertAbConfirmation,
  assertRuntimePrerequisites: assertAbRuntimePrerequisites,
  parseManifest: parseLegacyAbManifest,
  attestTargets: attestOrRefuse,
  importRuntime: async () => await import('./discovery.main'),
  importQualityRuntime: async () => await import('./discovery-quality.runtime'),
  importQualityChildRuntime: async (environment) => {
    const loader = await import('./discovery-quality.child-loader');
    return loader.loadAvailableHistoricalQualityChildRuntime(environment);
  },
};

/**
 * Runs the dependency-free bootstrap contract. A numeric result is a complete
 * pre-runtime response; undefined means the legacy runtime completed normally.
 */
export async function runDiscoveryBootstrap(
  args: readonly string[],
  env: NodeJS.ProcessEnv,
  io: Pick<Console, 'log' | 'error'>,
  dependencies: DiscoveryBootstrapDependencies = productionBootstrapDependencies,
): Promise<0 | 2 | undefined> {
  // Child recognition must precede every legacy gate, manifest parser, and
  // runtime import. The shared loader has no fallback, so a missing Task 6
  // implementation refuses here rather than after a parent restore.
  if (args.includes('--historical-quality-child')) {
    const runtime = await (dependencies.importQualityChildRuntime
      ?? productionBootstrapDependencies.importQualityChildRuntime!)(env);
    await runtime.runHistoricalQualityChild(args, env as HistoricalQualityChildEnvironment);
    return undefined;
  }
  // Help remains above every parent gate, environment read, runtime import, and live operation.
  if (isHistoricalQualityRequest(args)) {
    if (hasHistoricalQualityHelp(args)) {
      io.log(historicalQualityUsage());
      return 0;
    }
    const request = parseHistoricalQualityArgs(args);
    io.log(formatHistoricalQualityCost(request));
    const runtime = await (dependencies.importQualityRuntime ?? productionBootstrapDependencies.importQualityRuntime!)();
    await runtime.runHistoricalQualityRuntime(request);
    return undefined;
  }
  // Before the gate, and before any environment variable is read: the full
  // legacy contract, printed to anyone who asks for it.
  if (args.includes('--help') || args.includes('-h')) {
    io.log(abUsage());
    return 0;
  }
  // First, and before any network call: an unconfirmed run must not even
  // reach the control plane, let alone a database.
  dependencies.assertConfirmation(env);
  // Pure value-shape validation only: no secret is derived or checked against
  // a provider. This precedes manifest parsing and every live boundary so a
  // missing runtime cannot destroy disposable branches before failing.
  dependencies.assertRuntimePrerequisites(env);
  const manifest = dependencies.parseManifest(env.DISCOVERY_TARGETS);
  await dependencies.attestTargets(manifest, abInvocationRole(args));
  const sideId = childSideId(args);
  if (sideId !== undefined) {
    const target = manifest.targets.find((candidate) => candidate.sideId === sideId);
    if (!target) throw new Error(`Discovery manifest does not name side ${sideId}`);
    // The branch label is derived from the attested manifest, never from
    // operator-supplied text, so the child's gate checks an attested fact.
    env.DATABASE_URL = target.databaseUrl;
    env[AB_SIDE_BRANCH_ENV] = AB_BRANCH_NAMES[sideId];
  }
  const runtime = await dependencies.importRuntime();
  await runtime.main(args);
  return undefined;
}

async function main(): Promise<void> {
  const result = await runDiscoveryBootstrap(process.argv.slice(2), process.env, console);
  if (result !== undefined) process.exitCode = result;
}

if (import.meta.main) {
  main().catch((error: unknown) => {
    // `describeAbFailure` decides both halves of the report: which authored
    // message is safe to print (gate refusals name environment variables;
    // spend reports name stages; everything else is generic, because provider,
    // database and control-plane errors can carry credentials and response
    // bodies) and which exit code an operator should act on. The role is passed
    // because a child that failed after running the graph has already spent the
    // run, and must not print the parent's "nothing was spent" line.
    const report = describeAbFailure(error, abInvocationRole(process.argv.slice(2)));
    console.error(report.message);
    process.exitCode = report.exitCode;
  });
}
