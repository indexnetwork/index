#!/usr/bin/env bun
/** Dependency-free protected-base attesting bootstrap. */
import { attestMatrixTargets, createNeonControlPlane, parseAttestedManifest } from './discovery-env-matrix.neon';

function target(url: string): string { const value = new URL(url); return `${value.protocol}//${value.hostname}:${value.port || '5432'}${value.pathname}`; }
async function main(): Promise<void> {
  const manifest = parseAttestedManifest(process.env.DISCOVERY_ENV_MATRIX_CHILDREN, []);
  await attestMatrixTargets({ manifest, controlPlane: createNeonControlPlane(process.env.NEON_API_KEY ?? '') });
  if (!process.env.DATABASE_URL || target(process.env.DATABASE_URL) !== target(manifest.base.databaseUrl)) throw new Error('Protected base DATABASE_URL must exactly match the attested base target');
  process.env.DATABASE_URL = manifest.base.databaseUrl;
  const runtimeArgs = process.argv.includes('--verify') ? ['--verify'] : [];
  const runtime = await import('./discovery-env-matrix-base.main');
  await runtime.main(runtimeArgs);
}
function failureClass(error: unknown): string {
  const message = error instanceof Error && error.name === 'Error'
    ? String(error).slice('Error: '.length)
    : error && typeof error === 'object' && typeof (error as { message?: unknown }).message === 'string'
      ? (error as { message: string }).message
      : '';
  if (message.length === 0 && error && typeof error === 'object' && 'message' in error) return 'empty-message-error';
  if (message.startsWith('Neon control-plane') || message.startsWith('NEON_API_KEY')) return 'attestation';
  if (message.startsWith('Protected base DATABASE_URL') || message.startsWith('Discovery environment matrix target')) return 'target-binding';
  if (message.startsWith('DISCOVERY_ENV_MATRIX_CHILDREN') || message.startsWith('Manifest ')) return 'manifest';
  if (message.startsWith('Protected base') || message.startsWith('Fixture ') || message.startsWith('Expected ') || message.includes('base integrity')) return 'base-integrity';
  if (message.includes('OPENAI_API_KEY') || message.includes('OpenAI')) return 'openai-credential';
  if (message.includes('DATABASE_URL') || message.includes('connect') || message.includes('postgres') || message.includes('password') || message.includes('authentication') || message.includes('ECONN') || message.includes('timeout') || message.includes('28P') || message.includes('Failed query')) return 'database-connection';
  if (message.includes('historical-matrix') || message.includes('HISTORICAL_MATRIX_CASES')) return 'fixture-import';
  if (message.startsWith('Usage:')) return 'argument-forwarding';
  if (message.includes('required') || message.includes('Missing')) return 'missing-configuration';
  if (message.includes('Invalid') || message.includes('invalid')) return 'invalid-configuration';
  if (message.includes('Cannot') || message.includes('not a function') || message.includes('undefined')) return 'module-runtime';
  if (message.includes('Failed') || message.includes('failed')) return 'dependency-failure';
  if (message.startsWith('[') || message.startsWith('{')) return 'structured-dependency-error';
  if (message.startsWith('Error:')) return 'unclassified-standard-error';
  if (message.includes('Cannot find module') || message.includes('Failed to import')) return 'module-import';
  if (error instanceof TypeError) return 'runtime-type-error';
  if (error && typeof error === 'object') {
    const errorMessage = (error as { message?: unknown }).message;
    if (Array.isArray(errorMessage)) return 'runtime-message-array';
    if (errorMessage && typeof errorMessage === 'object') return 'runtime-message-object';
    if (errorMessage !== undefined && typeof errorMessage !== 'string') return 'runtime-message-primitive';
    const keys = Object.keys(error);
    if (keys.includes('errors')) return 'runtime-aggregate-error';
    if (keys.includes('code')) return 'runtime-coded-object';
    const ownNames = Object.getOwnPropertyNames(error);
    if (ownNames.includes('cause')) return 'runtime-object-cause';
    if (ownNames.includes('message')) return 'runtime-error-like-object';
    return 'runtime-object';
  }
  if (typeof error === 'string') return 'runtime-string';
  return 'unknown-runtime';
}
if (import.meta.main) main().catch((error: unknown) => { console.error(`Protected base command failed (${failureClass(error)})`); process.exitCode = 1; });
