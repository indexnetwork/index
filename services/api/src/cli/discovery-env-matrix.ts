#!/usr/bin/env bun
/** Dependency-free attesting bootstrap. Runtime imports occur only after Neon verification. */
import { attestMatrixTargets, createNeonControlPlane, parseAttestedManifest } from './discovery-env-matrix.neon';

const rowIds = ['intent-only', 'profile-premise', 'profile-context', 'both-premise', 'both-context'];
const keys = (canary: boolean) => rowIds.flatMap((id) => canary ? [`${id}-r1`] : [`${id}-r1`, `${id}-r2`, `${id}-r3`]);

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (args.includes('--help') || args.includes('-h')) return void (await import('./discovery-env-matrix.main')).main();
  const manifest = parseAttestedManifest(process.env.DISCOVERY_ENV_MATRIX_CHILDREN, keys(args.includes('--canary')));
  await attestMatrixTargets({ manifest, controlPlane: createNeonControlPlane(process.env.NEON_API_KEY ?? '') });
  // Runtime receives only the attested projection; branch labels are no longer trusted input.
  process.env.DISCOVERY_ENV_MATRIX_CHILDREN = JSON.stringify({ children: manifest.children.map((child) => ({ childKey: child.childKey, branch: `eval-discovery-env-matrix-${child.branchId}`, databaseUrl: child.databaseUrl, baseBranch: 'eval-discovery-base' })) });
  const childIndex = args.indexOf('--child-key');
  if (childIndex >= 0) {
    const child = manifest.children.find((entry) => entry.childKey === args[childIndex + 1]);
    if (!child) throw new Error('Unknown matrix child key');
    process.env.DATABASE_URL = child.databaseUrl;
    process.env.DISCOVERY_ENV_MATRIX_CHILD_BRANCH = `eval-discovery-env-matrix-${child.branchId}`;
  }
  await (await import('./discovery-env-matrix.main')).main();
}
if (import.meta.main) main().catch((error) => { console.error(error instanceof Error ? error.message : error); process.exitCode = 2; });
