#!/usr/bin/env bun
/**
 * Dependency-free attesting bootstrap for the discovery A/B harness.
 *
 * The property this file exists to preserve is an ordering one: the gate is
 * checked and both Neon targets are attested *before* anything that could
 * compose a database singleton is imported. `discovery-ab.main.ts` reaches
 * `@indexnetwork/protocol` through its very first import, so importing it
 * eagerly here would load the graph before the branches were proven. Every
 * import above is either `node:`-free control-plane code or the pure gate.
 *
 * Mirrors `discovery-env-matrix.ts`, with one difference: the A/B manifest
 * carries the same fields for parent and child, so there is no separate
 * attested projection to hand down — the child re-parses `DISCOVERY_AB_TARGETS`
 * and checks its own `DATABASE_URL` against it.
 *
 * `--help` is answered above all of it, from `discovery-ab.contract.ts`, which
 * imports nothing that can compose a database: an operator has to be able to
 * read what the command requires *before* they have any of it.
 */
import { AB_BRANCH_NAMES, attestAbTargets, parseAbManifest, type AbManifest } from './discovery-ab.neon';
import { AB_SIDE_BRANCH_ENV, AbGateError, assertAbConfirmation } from './discovery-ab.gate';
import { abUsage, describeAbFailure } from './discovery-ab.contract';
import { createNeonControlPlane } from './discovery-env-matrix.neon';

import type { AbSideId } from './discovery-ab.plan';

/**
 * Attests both targets, reporting a refusal an operator can act on without
 * echoing anything the control plane said.
 *
 * The underlying errors are already authored to carry only status codes and
 * field names, but they reach this boundary through `response.json()`, whose
 * own parse failures can quote response text. So the refusal is a fixed string:
 * it names what was refused (attestation) and what would satisfy it, and keeps
 * the original as `cause` for anyone holding the error rather than printing it.
 */
async function attestOrRefuse(manifest: AbManifest): Promise<void> {
  try {
    await attestAbTargets({ manifest, controlPlane: createNeonControlPlane(process.env.NEON_API_KEY ?? '') });
  } catch (error) {
    throw new AbGateError(
      `Refusing to run: DISCOVERY_AB_TARGETS was not attested as the two designated A/B branches `
      + `(${AB_BRANCH_NAMES.a}, ${AB_BRANCH_NAMES.b}) parented on eval-discovery-base. `
      + 'Nothing was reset and nothing was spawned.',
      { cause: error },
    );
  }
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
  // Before the gate, and before any environment variable is read: the full
  // contract, printed to anyone who asks for it.
  if (args.includes('--help') || args.includes('-h')) return void console.log(abUsage());
  // First, and before any network call: an unconfirmed run must not even
  // reach the control plane, let alone a database.
  assertAbConfirmation(process.env);
  const manifest = parseAbManifest(process.env.DISCOVERY_AB_TARGETS);
  await attestOrRefuse(manifest);
  const sideId = childSideId(args);
  if (sideId !== undefined) {
    const target = manifest.targets.find((candidate) => candidate.sideId === sideId);
    if (!target) throw new Error(`Discovery A/B manifest does not name side ${sideId}`);
    // The branch label is derived from the attested manifest, never from
    // operator-supplied text, so the child's gate checks an attested fact.
    process.env.DATABASE_URL = target.databaseUrl;
    process.env[AB_SIDE_BRANCH_ENV] = AB_BRANCH_NAMES[sideId];
  }
  await (await import('./discovery-ab.main')).main(args);
}

if (import.meta.main) {
  main().catch((error: unknown) => {
    // `describeAbFailure` decides both halves of the report: which authored
    // message is safe to print (gate refusals name environment variables;
    // spend reports name stages; everything else is generic, because provider,
    // database and control-plane errors can carry credentials and response
    // bodies) and which exit code an operator should act on.
    const report = describeAbFailure(error);
    console.error(report.message);
    process.exitCode = report.exitCode;
  });
}
