import type { LimiterStorage, HitResult } from './storage';

interface Bucket { count: number; resetAt: number }

export class MemoryStorage implements LimiterStorage {
  private buckets = new Map<string, Bucket>();
  private reaper: ReturnType<typeof setInterval> | null = null;

  constructor() {
    this.reaper = setInterval(() => this.reap(), 60_000);
    if (typeof this.reaper.unref === 'function') this.reaper.unref();
  }

  async hit(key: string, windowSec: number, max: number): Promise<HitResult> {
    const now = Date.now();
    let b = this.buckets.get(key);
    if (!b || b.resetAt <= now) {
      b = { count: 0, resetAt: now + windowSec * 1000 };
      this.buckets.set(key, b);
    }
    b.count += 1;
    return { count: b.count, resetAt: b.resetAt, allowed: b.count <= max, limit: max };
  }

  private reap() {
    const now = Date.now();
    for (const [k, b] of this.buckets) {
      if (b.resetAt <= now) this.buckets.delete(k);
    }
  }

  /** Test-only: stop the reaper so the process can exit cleanly. */
  stop() {
    if (this.reaper) { clearInterval(this.reaper); this.reaper = null; }
  }
}
