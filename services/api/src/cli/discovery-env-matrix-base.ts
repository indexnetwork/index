#!/usr/bin/env bun
/** Dependency-free protected-base attesting bootstrap. */
import { attestMatrixTargets, createNeonControlPlane, parseAttestedManifest } from './discovery-env-matrix.neon';

function target(url: string): string { const value = new URL(url); return `${value.protocol}//${value.hostname}:${value.port || '5432'}${value.pathname}`; }
async function main(): Promise<void> {
  const manifest = parseAttestedManifest(process.env.DISCOVERY_ENV_MATRIX_CHILDREN, []);
  await attestMatrixTargets({ manifest, controlPlane: createNeonControlPlane(process.env.NEON_API_KEY ?? '') });
  if (!process.env.DATABASE_URL || target(process.env.DATABASE_URL) !== target(manifest.base.databaseUrl)) throw new Error('Protected base DATABASE_URL must exactly match the attested base target');
  process.env.DATABASE_URL = manifest.base.databaseUrl;
  await (await import('./discovery-env-matrix-base.main')).main(process.argv.slice(2));
}
function failureClass(error: unknown): string {
  const message = error instanceof Error && error.name === 'Error' ? String(error).slice('Error: '.length) : '';
  if (message.startsWith('Neon control-plane') || message.startsWith('NEON_API_KEY')) return 'attestation';
  if (message.startsWith('Protected base DATABASE_URL') || message.startsWith('Discovery environment matrix target')) return 'target-binding';
  if (message.startsWith('DISCOVERY_ENV_MATRIX_CHILDREN') || message.startsWith('Manifest ')) return 'manifest';
  if (message.startsWith('Protected base') || message.startsWith('Fixture ') || message.startsWith('Expected ')) return 'base-integrity';
  return 'runtime';
}
if (import.meta.main) main().catch((error: unknown) => { console.error(`Protected base command failed (${failureClass(error)})`); process.exitCode = 1; });
