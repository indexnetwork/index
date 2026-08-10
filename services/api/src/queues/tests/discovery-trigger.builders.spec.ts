import { describe, expect, it } from 'bun:test';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { buildEnrichmentDiscoveryTrigger, buildIntentDiscoveryTrigger, type EnrichmentDiscoveryTrigger, type IntentDiscoveryTrigger } from '../opportunity/discovery-trigger.builders';
import type { FromEnrichmentGraphInvokeOptions } from '../opportunity/from-enrichment.queue';

const BUILDER_MODULE = path.resolve(import.meta.dir, '../opportunity/discovery-trigger.builders.ts');

type EnrichmentBuilderInput = Parameters<typeof buildEnrichmentDiscoveryTrigger>[0];

const queueTriggerWithExplicitUndefined: FromEnrichmentGraphInvokeOptions = {
  userId: 'legacy-user',
  operationMode: 'create',
  networkId: undefined,
  options: { initialStatus: 'latent' },
};
// @ts-expect-error — queue invoke callers must include the networkId property.
const queueTriggerMissingNetwork: FromEnrichmentGraphInvokeOptions = {
  userId: 'legacy-user',
  operationMode: 'create',
  options: { initialStatus: 'latent' },
};

// @ts-expect-error — quality builder callers must provide networkId.
const builderInputMissingNetwork: EnrichmentBuilderInput = { userId: 'quality-user' };
const builderInputWithUndefinedNetwork: EnrichmentBuilderInput = {
  userId: 'quality-user',
  // @ts-expect-error — quality builder callers must provide a concrete networkId.
  networkId: undefined,
};

void queueTriggerWithExplicitUndefined;
void queueTriggerMissingNetwork;
void builderInputMissingNetwork;
void builderInputWithUndefinedNetwork;

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

  it('builds the exact enrichment trigger shape and omits intent-only keys', () => {
    const trigger: EnrichmentDiscoveryTrigger = buildEnrichmentDiscoveryTrigger({
      userId: 'u1',
      networkId: 'idx1',
    });

    expect(trigger).toEqual({
      userId: 'u1',
      operationMode: 'create',
      networkId: 'idx1',
      options: { initialStatus: 'latent' },
    });
    expect(Object.keys(trigger)).toEqual(['userId', 'operationMode', 'networkId', 'options']);
    expect(trigger).not.toHaveProperty('searchQuery');
    expect(trigger).not.toHaveProperty('triggerIntentId');
    expect(trigger).not.toHaveProperty('indexScope');
  });

  it('differs between intent and enrichment only by their specified trigger fields', () => {
    const intent = buildIntentDiscoveryTrigger({
      userId: 'u1',
      searchQuery: 'Build a SaaS',
      networkIds: ['idx1'],
      triggerIntentId: 'i1',
    });
    const enrichment = buildEnrichmentDiscoveryTrigger({ userId: 'u1', networkId: 'idx1' });

    expect({ userId: intent.userId, networkId: intent.networkId, operationMode: intent.operationMode, options: intent.options })
      .toEqual(enrichment);
    expect(intent).toHaveProperty('searchQuery', 'Build a SaaS');
    expect(intent).toHaveProperty('triggerIntentId', 'i1');
    expect(enrichment).not.toHaveProperty('searchQuery');
    expect(enrichment).not.toHaveProperty('triggerIntentId');
  });

  it('is directly callable by quality consumers with a dependency-free import closure', async () => {
    const source = await readFile(BUILDER_MODULE, 'utf8');
    const staticSpecifiers = [...source.matchAll(/^\s*(?:import\s*(?=['"])|(?:import|export)\b[^;]*?\bfrom\s+)['"]([^'"]+)['"]/gm)]
      .map((match) => match[1]);

    expect(staticSpecifiers).toEqual([]);
    expect(source).not.toContain('from-intent.queue');
    expect(source).not.toContain('from-enrichment.queue');
    expect(source).not.toMatch(/bullmq|database|redis|neon|provider|callback/i);
    expect(buildIntentDiscoveryTrigger({
      userId: 'quality-user',
      searchQuery: 'quality query',
      networkIds: ['shared-network'],
      triggerIntentId: 'quality-intent',
    }).networkId).toBe('shared-network');
  });
});
