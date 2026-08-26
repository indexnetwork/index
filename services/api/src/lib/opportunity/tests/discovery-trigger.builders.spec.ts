import { describe, expect, it } from 'bun:test';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { buildIntentDiscoveryTrigger, type IntentDiscoveryTrigger } from '../discovery-trigger.builders';

const BUILDER_MODULE = path.resolve(import.meta.dir, '../discovery-trigger.builders.ts');

describe('production discovery trigger builders', () => {
  it('builds the exact single-network intent trigger shape', () => {
    const trigger: IntentDiscoveryTrigger = buildIntentDiscoveryTrigger({
      userId: 'u1',
      searchQuery: 'Build a SaaS',
      networkIds: ['idx1'],
      triggerIntentId: 'i1',
    });

    expect(trigger).toEqual({
      userId: 'u1',
      searchQuery: 'Build a SaaS',
      operationMode: 'create',
      networkId: 'idx1',
      triggerIntentId: 'i1',
      options: { initialStatus: 'latent' },
    });
    expect(Object.keys(trigger)).toEqual([
      'userId', 'searchQuery', 'operationMode', 'networkId', 'triggerIntentId', 'options',
    ]);
    expect(trigger).not.toHaveProperty('indexScope');
  });

  it('builds the exact multi-network intent trigger shape without mutating scope', () => {
    const networkIds = ['idx-a', 'idx-b'] as const;
    const trigger = buildIntentDiscoveryTrigger({
      userId: 'u1',
      searchQuery: 'Build a SaaS',
      networkIds,
      triggerIntentId: 'i1',
    });

    expect(trigger).toEqual({
      userId: 'u1',
      searchQuery: 'Build a SaaS',
      operationMode: 'create',
      indexScope: ['idx-a', 'idx-b'],
      triggerIntentId: 'i1',
      options: { initialStatus: 'latent' },
    });
    expect(Object.keys(trigger)).toEqual([
      'userId', 'searchQuery', 'operationMode', 'indexScope', 'triggerIntentId', 'options',
    ]);
    expect(trigger).not.toHaveProperty('networkId');
    expect(trigger.indexScope).not.toBe(networkIds);
  });

  it('rejects an empty authorized intent scope', () => {
    expect(() => buildIntentDiscoveryTrigger({
      userId: 'u1',
      searchQuery: 'Build a SaaS',
      networkIds: [],
      triggerIntentId: 'i1',
    })).toThrow('intent trigger requires authorized scope');
  });

  it('is directly callable by quality consumers with a dependency-free import closure', async () => {
    const source = await readFile(BUILDER_MODULE, 'utf8');
    const staticSpecifiers = [...source.matchAll(/^\s*(?:import\s*(?=['"])|(?:import|export)\b[^;]*?\bfrom\s+)['"]([^'"]+)['"]/gm)]
      .map((match) => match[1]);

    expect(staticSpecifiers).toEqual([]);
    expect(source).not.toContain('from-intent.queue');
    expect(source).not.toMatch(/bullmq|database|redis|neon|provider|callback/i);
    expect(buildIntentDiscoveryTrigger({
      userId: 'quality-user',
      searchQuery: 'quality query',
      networkIds: ['shared-network'],
      triggerIntentId: 'quality-intent',
    }).networkId).toBe('shared-network');
  });
});
