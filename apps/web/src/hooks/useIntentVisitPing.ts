import { useEffect } from 'react';

import { useIntents } from '@/contexts/APIContext';

/**
 * Best-effort explicit human visit ping for an intent-page mount.
 * Failures are intentionally swallowed so analytics/suppression bookkeeping
 * can never block rendering or replace the intent with an error state.
 */
export function useIntentVisitPing(intentId?: string): void {
  const intentsService = useIntents();

  useEffect(() => {
    if (!intentId) return;
    void intentsService.visitIntent(intentId).catch(() => {});
  }, [intentId, intentsService]);
}
