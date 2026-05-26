/** Config */
import { config } from "dotenv";
config({ path: '.env.test', override: true });

import { describe, it, expect } from "bun:test";
import { computeFeedHealth } from "../feed/feed.health.js";

const WINDOW_12H = 12 * 60 * 60 * 1000;

describe('computeFeedHealth', () => {
  it('returns score 0 and shouldMaintain=true for an empty feed', () => {
    const result = computeFeedHealth({
      connectionCount: 0,
      connectorFlowCount: 0,
      expiredCount: 0,
      totalActionable: 0,
      lastRediscoveryAt: null,
      freshnessWindowMs: WINDOW_12H,
    });
    expect(result.score).toBe(0);
    expect(result.shouldMaintain).toBe(true);
    expect(result.breakdown.composition).toBe(0);
    expect(result.breakdown.freshness).toBe(0);
    expect(result.breakdown.expirationRatio).toBe(0);
  });

  it('returns high score for a healthy feed discovered recently with good composition', () => {
    const result = computeFeedHealth({
      connectionCount: 5,
      connectorFlowCount: 3,
      expiredCount: 1,
      totalActionable: 8,
      lastRediscoveryAt: Date.now() - 1000, // 1 second ago
      freshnessWindowMs: WINDOW_12H,
    });
    expect(result.score).toBeGreaterThan(0.5);
    expect(result.breakdown.freshness).toBeGreaterThan(0.99);
    expect(result.shouldMaintain).toBe(false);
  });

  it('returns low freshness when lastRediscoveryAt is null', () => {
    const result = computeFeedHealth({
      connectionCount: 5,
      connectorFlowCount: 3,
      expiredCount: 0,
      totalActionable: 8,
      lastRediscoveryAt: null,
      freshnessWindowMs: WINDOW_12H,
    });
    expect(result.breakdown.freshness).toBe(0);
  });

  it('returns freshness=0 when elapsed time exceeds the window', () => {
    const result = computeFeedHealth({
      connectionCount: 5,
      connectorFlowCount: 3,
      expiredCount: 0,
      totalActionable: 8,
      lastRediscoveryAt: Date.now() - WINDOW_12H - 1000,
      freshnessWindowMs: WINDOW_12H,
    });
    expect(result.breakdown.freshness).toBe(0);
  });

  it('respects custom threshold', () => {
    const result = computeFeedHealth({
      connectionCount: 5,
      connectorFlowCount: 3,
      expiredCount: 0,
      totalActionable: 8,
      lastRediscoveryAt: Date.now() - 1000,
      freshnessWindowMs: WINDOW_12H,
      threshold: 0.99, // almost nothing passes this threshold
    });
    expect(result.shouldMaintain).toBe(true);
  });

  it('returns low expirationRatio when most items are expired', () => {
    const result = computeFeedHealth({
      connectionCount: 5,
      connectorFlowCount: 3,
      expiredCount: 9,
      totalActionable: 1,
      lastRediscoveryAt: Date.now() - 1000,
      freshnessWindowMs: WINDOW_12H,
    });
    // expiredCount=9, totalActionable=1 → total=10, expirationRatio = 1 - 9/10 = 0.1
    expect(result.breakdown.expirationRatio).toBeCloseTo(0.1, 5);
  });

  it('expirationRatio is 1 when no expired items', () => {
    const result = computeFeedHealth({
      connectionCount: 5,
      connectorFlowCount: 3,
      expiredCount: 0,
      totalActionable: 5,
      lastRediscoveryAt: Date.now() - 1000,
      freshnessWindowMs: WINDOW_12H,
    });
    expect(result.breakdown.expirationRatio).toBe(1);
  });

  it('score is between 0 and 1 for arbitrary valid input', () => {
    const result = computeFeedHealth({
      connectionCount: 2,
      connectorFlowCount: 1,
      expiredCount: 3,
      totalActionable: 5,
      lastRediscoveryAt: Date.now() - WINDOW_12H / 2,
      freshnessWindowMs: WINDOW_12H,
    });
    expect(result.score).toBeGreaterThanOrEqual(0);
    expect(result.score).toBeLessThanOrEqual(1);
  });
});
