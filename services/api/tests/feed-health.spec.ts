import { config } from 'dotenv';
config({ path: '.env.test', override: true });

import { describe, it, expect } from 'bun:test';
import { computeFeedHealth, type FeedHealthInput } from '@indexnetwork/protocol';

describe('computeFeedHealth', () => {
  const now = Date.now();

  it('returns perfect score for ideal composition with recent rediscovery', () => {
    const input: FeedHealthInput = {
      connectionCount: 3,
      connectorFlowCount: 2,
      expiredCount: 0,
      totalActionable: 5,
      lastRediscoveryAt: now - 1000, // 1 second ago
      freshnessWindowMs: 12 * 60 * 60 * 1000,
    };
    const result = computeFeedHealth(input);
    expect(result.score).toBeGreaterThan(0.85);
    expect(result.shouldMaintain).toBe(false);
  });

  it('returns zero score for empty feed', () => {
    const input: FeedHealthInput = {
      connectionCount: 0,
      connectorFlowCount: 0,
      expiredCount: 0,
      totalActionable: 0,
      lastRediscoveryAt: null,
      freshnessWindowMs: 12 * 60 * 60 * 1000,
    };
    const result = computeFeedHealth(input);
    expect(result.score).toBe(0);
    expect(result.shouldMaintain).toBe(true);
  });

  it('penalizes stale feed (old rediscovery)', () => {
    const input: FeedHealthInput = {
      connectionCount: 3,
      connectorFlowCount: 2,
      expiredCount: 0,
      totalActionable: 5,
      lastRediscoveryAt: now - 24 * 60 * 60 * 1000, // 24h ago
      freshnessWindowMs: 12 * 60 * 60 * 1000,
    };
    const result = computeFeedHealth(input);
    expect(result.breakdown.freshness).toBe(0);
    expect(result.score).toBeLessThan(0.8);
  });

  it('penalizes high expiration ratio', () => {
    const input: FeedHealthInput = {
      connectionCount: 1,
      connectorFlowCount: 0,
      expiredCount: 4,
      totalActionable: 1,
      lastRediscoveryAt: now - 1000,
      freshnessWindowMs: 12 * 60 * 60 * 1000,
    };
    const result = computeFeedHealth(input);
    expect(result.breakdown.expirationRatio).toBeLessThan(0.3);
  });

  it('penalizes unbalanced composition', () => {
    const input: FeedHealthInput = {
      connectionCount: 10,
      connectorFlowCount: 0,
      expiredCount: 0,
      totalActionable: 10,
      lastRediscoveryAt: now - 1000,
      freshnessWindowMs: 12 * 60 * 60 * 1000,
    };
    const result = computeFeedHealth(input);
    expect(result.breakdown.composition).toBeLessThan(1);
  });

  it('respects custom threshold', () => {
    const input: FeedHealthInput = {
      connectionCount: 2,
      connectorFlowCount: 1,
      expiredCount: 1,
      totalActionable: 3,
      lastRediscoveryAt: now - 8 * 60 * 60 * 1000,
      freshnessWindowMs: 12 * 60 * 60 * 1000,
      threshold: 0.8,
    };
    const result = computeFeedHealth(input);
    expect(result.shouldMaintain).toBe(result.score < 0.8);
  });

  it('exposes breakdown with all three sub-scores', () => {
    const input: FeedHealthInput = {
      connectionCount: 3,
      connectorFlowCount: 2,
      expiredCount: 0,
      totalActionable: 5,
      lastRediscoveryAt: now - 1000,
      freshnessWindowMs: 12 * 60 * 60 * 1000,
    };
    const result = computeFeedHealth(input);
    expect(result.breakdown).toHaveProperty('composition');
    expect(result.breakdown).toHaveProperty('freshness');
    expect(result.breakdown).toHaveProperty('expirationRatio');
  });
});
