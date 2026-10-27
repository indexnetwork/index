import type { ServerContext } from '@modelcontextprotocol/server';

/**
 * Phase-by-phase tool progress in the trace UI's voice ("Discovering
 * counterparties..."). Each call marks the next phase starting; hosts show
 * only the latest message beside their own spinner, so every line must stand
 * alone. Plain ASCII only. Omit `total` for open-ended phases, such as a
 * discovery watch. Returns a no-op when the client sent no progressToken, and
 * a failed notification never fails the tool.
 */
export function mcpProgress(ctx: ServerContext, total?: number): (message: string) => Promise<void> {
  const progressToken = ctx.mcpReq._meta?.progressToken;
  if (progressToken === undefined) return () => Promise.resolve();
  let completed = -1;
  return async (message: string) => {
    completed = total === undefined ? completed + 1 : Math.min(completed + 1, total - 1);
    try {
      await ctx.mcpReq.notify({
        method: 'notifications/progress',
        params: { progressToken, progress: completed, ...(total !== undefined && { total }), message },
      });
    } catch {
      // Progress is cosmetic; the tool result is the contract.
    }
  };
}

/**
 * Whether the client asked for progress. Progress notifications also reset
 * host timeouts, so a long quiet wait is only safe when this is true.
 */
export function clientRequestedProgress(ctx: ServerContext): boolean {
  return ctx.mcpReq._meta?.progressToken !== undefined;
}
