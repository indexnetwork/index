#!/usr/bin/env bun
/** Dependency-free protected-base attesting bootstrap. */
import { attestMatrixTargets, createNeonControlPlane, parseAttestedManifest, type AttestedManifest } from './discovery-env-matrix.neon';

const RUNTIME_PATH = new URL('./discovery-env-matrix-base.runtime.ts', import.meta.url).pathname;

type BaseRuntimeChild = {
  stdout: ReadableStream<Uint8Array> | null;
  stderr: ReadableStream<Uint8Array> | null;
  exited: Promise<number>;
};
type BaseRuntimeSpawnOptions = {
  cmd: string[];
  env: NodeJS.ProcessEnv;
  stdout: 'pipe';
  stderr: 'pipe';
};
type BaseRuntimeSpawn = (options: BaseRuntimeSpawnOptions) => BaseRuntimeChild;

export class BaseRuntimeChildError extends Error {
  constructor(readonly exitCode: number) {
    super('Protected base runtime child exited unsuccessfully');
    this.name = 'BaseRuntimeChildError';
  }
}

function target(url: string): string {
  const value = new URL(url);
  return `${value.protocol}//${value.hostname}:${value.port || '5432'}${value.pathname}`;
}

/** Drains untrusted child stderr without retaining or forwarding its contents. */
async function discardOutput(stream: ReadableStream<Uint8Array> | null): Promise<void> {
  if (!stream) return;
  const reader = stream.getReader();
  while (!(await reader.read()).done) { /* discard */ }
}

/** Runs the already-bound runtime outside the attesting process and never exposes child stderr. */
export async function handoffBaseRuntime(input: {
  args: readonly string[];
  databaseUrl: string;
  env?: NodeJS.ProcessEnv;
  runtimePath?: string;
  spawn?: BaseRuntimeSpawn;
}): Promise<string> {
  const { NEON_API_KEY: _neonApiKey, DISCOVERY_ENV_MATRIX_CHILDREN: _manifest, ...runtimeEnv } = input.env ?? process.env;
  const options: BaseRuntimeSpawnOptions = {
    cmd: [process.execPath, '--no-env-file', input.runtimePath ?? RUNTIME_PATH, ...input.args],
    env: { ...runtimeEnv, DATABASE_URL: input.databaseUrl },
    stdout: 'pipe',
    // Deliberately consume and discard child stderr: only this bootstrap prints failure classes.
    stderr: 'pipe',
  };
  const child = input.spawn
    ? input.spawn(options)
    : Bun.spawn(options) as BaseRuntimeChild;
  const [exitCode, stdout] = await Promise.all([
    child.exited,
    child.stdout ? new Response(child.stdout).text() : Promise.resolve(''),
    discardOutput(child.stderr),
  ]);
  if (exitCode !== 0) throw new BaseRuntimeChildError(exitCode);
  return stdout;
}

export async function runProtectedBaseBootstrap(input: {
  args: readonly string[];
  env?: NodeJS.ProcessEnv;
  attest?: (manifest: AttestedManifest) => Promise<unknown>;
  handoff?: (args: readonly string[], databaseUrl: string) => Promise<string>;
}): Promise<string> {
  const env = input.env ?? process.env;
  const manifest = parseAttestedManifest(env.DISCOVERY_ENV_MATRIX_CHILDREN, []);
  await (input.attest ?? ((attested) => attestMatrixTargets({
    manifest: attested,
    controlPlane: createNeonControlPlane(env.NEON_API_KEY ?? ''),
  })))(manifest);
  if (!env.DATABASE_URL || target(env.DATABASE_URL) !== target(manifest.base.databaseUrl)) {
    throw new Error('Protected base DATABASE_URL must exactly match the attested base target');
  }
  // Preserve the existing wrapper argument contract: the runtime receives only --verify.
  const runtimeArgs = input.args.includes('--verify') ? ['--verify'] : [];
  return (input.handoff ?? ((args, databaseUrl) => handoffBaseRuntime({ args, databaseUrl, env })))(runtimeArgs, manifest.base.databaseUrl);
}

async function main(): Promise<void> {
  const stdout = await runProtectedBaseBootstrap({ args: process.argv.slice(2) });
  if (stdout) process.stdout.write(stdout);
}

function failureClass(error: unknown): string {
  if (error instanceof BaseRuntimeChildError) return 'runtime-child-exit';
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

if (import.meta.main) main().catch((error: unknown) => {
  console.error(`Protected base command failed (${failureClass(error)})`);
  process.exitCode = error instanceof BaseRuntimeChildError && error.exitCode > 0 ? error.exitCode : 1;
});
