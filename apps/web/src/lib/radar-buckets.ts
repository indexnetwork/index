/** The Radar opens on live broker activity instead of a passive backlog. */
export const DEFAULT_RADAR_BUCKET = 'negotiating';

/**
 * Pending opportunities need a visible call to action even when another Radar
 * tab is selected. Other count badges remain neutral (or inherit selection).
 */
export function radarBucketBadgeTone(
  bucketKey: string,
  value: number,
  active: boolean,
): string {
  if (bucketKey === 'pending' && value > 0) {
    return 'bg-amber-200 text-amber-950';
  }
  return active ? 'bg-white/20 text-white' : 'bg-gray-100 text-gray-500';
}
