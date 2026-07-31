#!/usr/bin/env bun
/** Dependency-free attesting bootstrap. Runtime imports occur only after Neon verification. */
import { attestMatrixTargets, createNeonControlPlane, parseAttestedManifest } from './discovery-env-matrix.neon';

const rowIds = ['intent-only', 'profile-premise', 'profile-context', 'both-premise', 'both-context'];
const keys = (canary: boolean) => rowIds.flatMap((id) => canary ? [`${id}-r1`] : [`${id}-r1`, `${id}-r2`, `${id}-r3`]);

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (args.includes('--help') || args.includes('-h')) return void console.log('Discovery environment matrix eval\n\nRequires an attested Neon v1 manifest and NEON_API_KEY.');
  // Parent runs receive the operator manifest. Re-execed children receive its
  // attested copy because their runtime projection intentionally omits control-plane IDs.
  const rawManifest = args.includes('--child-key')
    ? process.env.DISCOVERY_ENV_MATRIX_ATTESTED_MANIFEST ?? process.env.DISCOVERY_ENV_MATRIX_CHILDREN
    : process.env.DISCOVERY_ENV_MATRIX_CHILDREN;
  const manifest = parseAttestedManifest(rawManifest, keys(args.includes('--canary')));
  await attestMatrixTargets({ manifest, controlPlane: createNeonControlPlane(process.env.NEON_API_KEY ?? '') });
  // Runtime receives only the attested projection; branch labels are no longer trusted input.
  process.env.DISCOVERY_ENV_MATRIX_ATTESTED_MANIFEST = rawManifest;
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
if (import.meta.main) main().catch(() => { console.error('Discovery environment matrix command failed'); process.exitCode = 2; });
