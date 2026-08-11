type AsyncOrSyncCallback = () => unknown | Promise<unknown>;
type HookRegistrar = (callback: AsyncOrSyncCallback, timeout?: number) => unknown;
type TestRegistrar = (name: string, callback: AsyncOrSyncCallback, timeout?: number) => unknown;

/**
 * Observes a promise immediately and preserves its eventual value or reason.
 *
 * Race fixtures use this before releasing database barriers so a contender that
 * rejects as soon as the barrier opens is never briefly unhandled.
 *
 * @param promise - Contender promise to observe.
 * @returns A fulfilled result carrying the exact value or rejection reason.
 */
export function settlePromiseOutcome<T>(promise: Promise<T>): Promise<PromiseSettledResult<T>> {
  return promise.then<PromiseSettledResult<T>, PromiseSettledResult<T>>(
    (value) => ({ status: 'fulfilled', value }),
    (reason: unknown) => ({ status: 'rejected', reason }),
  );
}

/**
 * Gives a latency-sensitive database test a file-local minimum timeout.
 *
 * @param register - Bun test/it registrar.
 * @param minimumMs - Minimum timeout justified for this integration file.
 * @returns A registrar that preserves larger explicit per-test budgets.
 */
export function withMinimumDatabaseTestBudget(
  register: TestRegistrar,
  minimumMs: number,
): TestRegistrar {
  return (name, callback, timeout) =>
    register(name, callback, Math.max(timeout ?? 0, minimumMs));
}

/**
 * Gives a database fixture hook a file-local minimum timeout.
 *
 * @param register - Bun before/after hook registrar.
 * @param minimumMs - Minimum timeout justified for this integration fixture.
 * @returns A registrar that preserves larger explicit hook budgets.
 */
export function withMinimumDatabaseHookBudget(
  register: HookRegistrar,
  minimumMs: number,
): HookRegistrar {
  return (callback, timeout) =>
    register(callback, Math.max(timeout ?? 0, minimumMs));
}
