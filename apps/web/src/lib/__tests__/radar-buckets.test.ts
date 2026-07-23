import { describe, expect, it } from 'vitest';

import { DEFAULT_RADAR_BUCKET, radarBucketBadgeTone } from '@/lib/radar-buckets';

describe('Radar bucket presentation', () => {
  it('opens on live negotiations', () => {
    expect(DEFAULT_RADAR_BUCKET).toBe('negotiating');
  });

  it('gives a non-zero Awaiting you badge an attention tone', () => {
    expect(radarBucketBadgeTone('pending', 1, false)).toBe('bg-amber-200 text-amber-950');
    expect(radarBucketBadgeTone('pending', 3, true)).toBe('bg-amber-200 text-amber-950');
  });

  it('keeps zero and other badges neutral or selected', () => {
    expect(radarBucketBadgeTone('pending', 0, false)).toBe('bg-gray-100 text-gray-500');
    expect(radarBucketBadgeTone('negotiating', 2, true)).toBe('bg-white/20 text-white');
  });
});
