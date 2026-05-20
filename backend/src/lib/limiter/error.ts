import type { LimiterClass } from './config';

export class RateLimiterError extends Error {
  constructor(
    public readonly cls: LimiterClass,
    public readonly limit: number,
    public readonly remaining: number,
    public readonly resetAt: number,
  ) {
    super('Too Many Requests');
    this.name = 'RateLimiterError';
  }

  get retryAfterSeconds(): number {
    return Math.max(0, Math.ceil((this.resetAt - Date.now()) / 1000));
  }

  toResponseInit(corsHeaders: Record<string, string>): ResponseInit {
    return {
      status: 429,
      headers: {
        'Content-Type': 'application/json',
        'ratelimit-limit': String(this.limit),
        'ratelimit-remaining': String(this.remaining),
        'ratelimit-reset': String(this.retryAfterSeconds),
        'retry-after': String(this.retryAfterSeconds),
        ...corsHeaders,
      },
    };
  }

  toBody(): string {
    return JSON.stringify({
      error: 'Too Many Requests',
      code: 'RATE_LIMITED',
      class: this.cls,
      retryAfterSeconds: this.retryAfterSeconds,
    });
  }
}
