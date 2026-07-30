import { isFastSignalIntakeEnabled } from '../lib/fast-intake-feature';

/**
 * Environment-based guard that gates the deterministic fast-intake funnel
 * (`/intents/intake/*`). Returns void when the flag is enabled; throws
 * (mapped to 404 in main.ts) when disabled, so a flag-off deployment does not
 * expose these endpoints at all — including to unauthenticated requests,
 * since this guard must run before AuthGuard.
 * Enabled only when FAST_SIGNAL_INTAKE === 'true' (disabled when unset).
 */
export const FastSignalIntakeEnabledGuard = async (_req: Request): Promise<void> => {
  if (!isFastSignalIntakeEnabled()) {
    throw new Error('Not found');
  }
};
