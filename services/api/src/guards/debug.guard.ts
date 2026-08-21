/**
 * Environment-based guard that gates debug API endpoints.
 * Returns void when debug is enabled; throws (404) when disabled.
 * Enabled when NODE_ENV === 'development'.
 */
export const DebugGuard = async (_req: Request): Promise<void> => {
  if (process.env.NODE_ENV !== "development") {
    throw new Error("Not found");
  }
};
