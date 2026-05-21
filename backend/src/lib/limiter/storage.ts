export interface HitResult {
  count: number;
  resetAt: number;
  allowed: boolean;
  limit: number;
}

export interface LimiterStorage {
  /**
   * Increment the bucket at `key` and report current count vs `max`.
   * On first hit in a window, sets the TTL to `windowSec`.
   */
  hit(key: string, windowSec: number, max: number): Promise<HitResult>;
  /** Optional lifecycle hook (e.g., Redis SCRIPT LOAD). */
  bootstrap?(): Promise<void>;
}
