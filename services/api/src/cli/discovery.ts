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
import { AB_BRANCH_NAMES, attestAbTargets, parseAbManifest, type AbManifest } from './discovery.neon';
import { AB_SIDE_BRANCH_ENV, assertAbConfirmation } from './discovery.gate';
import { abAttestationRefusal, abUsage, describeAbFailure, type AbInvocationRole } from './discovery.contract';
import { createNeonControlPlane } from './discovery-env-matrix.neon';
import { hasHistoricalQualityHelp, historicalQualityUsage, isHistoricalQualityRequest, parseHistoricalQualityArgs, runHistoricalQualityPrARefusal } from './discovery-quality.contract';

import type { AbSideId } from './discovery.plan';

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

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  // The dedicated quality shape is parsed, costed, and refused before the
  // legacy confirmation gate, manifest, attestation, or dynamic runtime import.
  // PR A deliberately performs no provider or infrastructure operation.
  if (isHistoricalQualityRequest(args)) {
    if (hasHistoricalQualityHelp(args)) return void console.log(historicalQualityUsage());
    process.exitCode = runHistoricalQualityPrARefusal(parseHistoricalQualityArgs(args), console);
    return;
  }
  // Before the gate, and before any environment variable is read: the full
  // legacy contract, printed to anyone who asks for it.
  if (args.includes('--help') || args.includes('-h')) return void console.log(abUsage());
  // First, and before any network call: an unconfirmed run must not even
  // reach the control plane, let alone a database.
  assertAbConfirmation(process.env);
  const manifest = parseAbManifest(process.env.DISCOVERY_TARGETS);
  await attestOrRefuse(manifest, abInvocationRole(args));
  const sideId = childSideId(args);
  if (sideId !== undefined) {
    const target = manifest.targets.find((candidate) => candidate.sideId === sideId);
    if (!target) throw new Error(`Discovery manifest does not name side ${sideId}`);
    // The branch label is derived from the attested manifest, never from
    // operator-supplied text, so the child's gate checks an attested fact.
    process.env.DATABASE_URL = target.databaseUrl;
    process.env[AB_SIDE_BRANCH_ENV] = AB_BRANCH_NAMES[sideId];
  }
  await (await import('./discovery.main')).main(args);
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
