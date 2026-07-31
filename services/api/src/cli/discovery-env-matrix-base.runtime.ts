#!/usr/bin/env bun
/** Safe, direct runtime entrypoint for the protected-base child process. */
export async function runBaseRuntimeMain(args: readonly string[] = process.argv.slice(2)): Promise<number> {
  try {
    const runtime = await import('./discovery-env-matrix-base.main');
    await runtime.main(args);
    return 0;
  } catch {
    // Runtime/provider/database failures can contain credentials or response bodies.
    console.error('Protected base runtime failed');
    return 1;
  }
}

if (import.meta.main) process.exitCode = await runBaseRuntimeMain();
