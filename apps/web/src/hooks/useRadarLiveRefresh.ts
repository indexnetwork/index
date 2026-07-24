import { useEffect, useRef } from "react";

export const RADAR_REFRESH_INTERVAL_MS = 5_000;

/**
 * Refreshes an exact-intent Radar immediately when its scoped SSE revision
 * changes and periodically as a lifecycle-event fallback.
 */
export function useRadarLiveRefresh({
  intentId,
  activityRevision,
  onRefresh,
}: {
  intentId: string | undefined;
  activityRevision: string;
  onRefresh: () => void;
}) {
  const seenRevision = useRef<string | null>(null);
  const seenIntentId = useRef<string | undefined>(intentId);

  useEffect(() => {
    if (seenIntentId.current !== intentId) {
      seenIntentId.current = intentId;
      seenRevision.current = activityRevision || null;
      return;
    }
    if (!activityRevision) return;
    if (seenRevision.current === null) {
      seenRevision.current = activityRevision;
      return;
    }
    if (seenRevision.current === activityRevision) return;
    seenRevision.current = activityRevision;
    onRefresh();
  }, [activityRevision, intentId, onRefresh]);

  useEffect(() => {
    if (!intentId) return;
    const timer = setInterval(onRefresh, RADAR_REFRESH_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [intentId, onRefresh]);
}
