/**
 * Environment-based guard that gates debug API endpoints.
 * Returns void when debug is enabled; throws (404) when disabled.
 * Enabled when NODE_ENV === 'development' or ENABLE_DEBUG_API === 'true'.
 */
export const DebugGuard = async (_req: Request): Promise<void> => {
  const isDev = process.env.NODE_ENV === "development";
  const isExplicitlyEnabled = process.env.ENABLE_DEBUG_API === "true";

  if (!isDev && !isExplicitlyEnabled) {
    throw new Error("Not found");
  }
};
