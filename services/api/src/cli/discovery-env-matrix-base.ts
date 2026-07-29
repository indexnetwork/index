#!/usr/bin/env bun
/** Dependency-free protected-base attesting bootstrap. */
import { attestMatrixTargets, createNeonControlPlane, parseAttestedManifest } from './discovery-env-matrix.neon';

function target(url: string): string { const value = new URL(url); return `${value.protocol}//${value.hostname}:${value.port || '5432'}${value.pathname}`; }
async function main(): Promise<void> {
  const manifest = parseAttestedManifest(process.env.DISCOVERY_ENV_MATRIX_CHILDREN, []);
  await attestMatrixTargets({ manifest, controlPlane: createNeonControlPlane(process.env.NEON_API_KEY ?? '') });
  if (!process.env.DATABASE_URL || target(process.env.DATABASE_URL) !== target(manifest.base.databaseUrl)) throw new Error('Protected base DATABASE_URL must exactly match the attested base target');
  process.env.DATABASE_URL = manifest.base.databaseUrl;
  await (await import('./discovery-env-matrix-base.main')).main();
}
if (import.meta.main) main().catch(() => { console.error('Protected base command failed'); process.exitCode = 1; });
