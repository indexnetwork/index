#!/usr/bin/env bun

/** Imports the bound runtime only inside the fresh child process. */
export async function runHistoricalQualityBaseRuntime(args: readonly string[] = process.argv.slice(2)): Promise<number> {
  try {
    const runtime = await import('./discovery-quality-base.main');
    await runtime.main(args);
    return 0;
  } catch {
    console.error('Historical quality base runtime failed');
    return 1;
  }
}

if (import.meta.main) process.exitCode = await runHistoricalQualityBaseRuntime();
