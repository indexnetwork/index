import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';

import { _resetForTesting, handleOpportunityBatch } from '../index.js';
import type { OpenClawPluginApi, SubagentRunOptions } from '../plugin-api.js';

interface FakeApi {
  api: OpenClawPluginApi;
  subagentCalls: SubagentRunOptions[];
  logger: {
    warn: ReturnType<typeof mock>;
    error: ReturnType<typeof mock>;
    info: ReturnType<typeof mock>;
    debug: ReturnType<typeof mock>;
  };
}

function buildFakeApi(deliveryConfigured = true): FakeApi {
  const subagentCalls: SubagentRunOptions[] = [];
  const logger = {
    debug: mock(() => {}),
    info: mock(() => {}),
    warn: mock(() => {}),
    error: mock(() => {}),
  };

  const api: OpenClawPluginApi = {
    id: 'indexnetwork-openclaw-plugin',
    name: 'Index Network',
    pluginConfig: deliveryConfigured
      ? { deliveryChannel: 'telegram', deliveryTarget: '69340471' }
      : {},
    runtime: {
      subagent: {
        run: async (opts) => {
          subagentCalls.push(opts);
          return { runId: 'fake-run-id' };
        },
      },
    },
    logger,
    registerHttpRoute: mock(() => {}),
  };

  return { api, subagentCalls, logger };
}

const BASE_URL = 'http://localhost:3001';
const AGENT_ID = 'agent-123';
const API_KEY = 'test-api-key';

const SAMPLE_CANDIDATE = {
  opportunityId: 'opp-abc',
  rendered: {
    headline: 'Great match found',
    personalizedSummary: 'Alice is looking for a TypeScript engineer.',
    suggestedAction: 'Send a connection request to Alice.',
    narratorRemark: 'This looks like a perfect fit.',
  },
};

describe('handleOpportunityBatch', () => {
  let originalFetch: typeof global.fetch;

  beforeEach(() => {
    originalFetch = global.fetch;
    _resetForTesting();
  });

  afterEach(() => {
    global.fetch = originalFetch;
    _resetForTesting();
  });

  test('returns false and no subagent when /pending returns empty array', async () => {
    global.fetch = mock(async () =>
      new Response(JSON.stringify({ opportunities: [] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    ) as unknown as typeof fetch;

    const fake = buildFakeApi();
    const result = await handleOpportunityBatch(fake.api, BASE_URL, AGENT_ID, API_KEY);

    expect(result).toBe(false);
    expect(fake.subagentCalls).toHaveLength(0);
  });

  test('returns false and logs warn when /pending returns non-2xx', async () => {
    global.fetch = mock(async () =>
      new Response('Internal Server Error', { status: 500 }),
    ) as unknown as typeof fetch;

    const fake = buildFakeApi();
    const result = await handleOpportunityBatch(fake.api, BASE_URL, AGENT_ID, API_KEY);

    expect(result).toBe(false);
    expect(fake.subagentCalls).toHaveLength(0);
    expect(fake.logger.warn).toHaveBeenCalled();
  });

  test('returns false when delivery routing not configured', async () => {
    global.fetch = mock(async () =>
      new Response(JSON.stringify({ opportunities: [SAMPLE_CANDIDATE] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    ) as unknown as typeof fetch;

    const fake = buildFakeApi(false); // no deliveryChannel/deliveryTarget
    const result = await handleOpportunityBatch(fake.api, BASE_URL, AGENT_ID, API_KEY);

    expect(result).toBe(false);
    expect(fake.subagentCalls).toHaveLength(0);
    expect(fake.logger.warn).toHaveBeenCalled();
  });

  test('launches one subagent with deliver:true when candidates present', async () => {
    global.fetch = mock(async () =>
      new Response(JSON.stringify({ opportunities: [SAMPLE_CANDIDATE] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    ) as unknown as typeof fetch;

    const fake = buildFakeApi();
    const result = await handleOpportunityBatch(fake.api, BASE_URL, AGENT_ID, API_KEY);

    expect(result).toBe(true);
    expect(fake.subagentCalls).toHaveLength(1);
    expect(fake.subagentCalls[0].deliver).toBe(true);
  });

  test('subagent prompt contains candidate data', async () => {
    global.fetch = mock(async () =>
      new Response(JSON.stringify({ opportunities: [SAMPLE_CANDIDATE] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    ) as unknown as typeof fetch;

    const fake = buildFakeApi();
    await handleOpportunityBatch(fake.api, BASE_URL, AGENT_ID, API_KEY);

    const message = fake.subagentCalls[0].message;
    expect(message).toContain(SAMPLE_CANDIDATE.opportunityId);
    expect(message).toContain(SAMPLE_CANDIDATE.rendered.headline);
    expect(message).toContain(SAMPLE_CANDIDATE.rendered.personalizedSummary);
    expect(message).toContain(SAMPLE_CANDIDATE.rendered.suggestedAction);
  });

  test('uses correct sessionKey for Telegram delivery', async () => {
    global.fetch = mock(async () =>
      new Response(JSON.stringify({ opportunities: [SAMPLE_CANDIDATE] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    ) as unknown as typeof fetch;

    const fake = buildFakeApi();
    await handleOpportunityBatch(fake.api, BASE_URL, AGENT_ID, API_KEY);

    expect(fake.subagentCalls[0].sessionKey).toBe('agent:main:telegram:direct:69340471');
  });

  test('idempotencyKey is stable for the same batch regardless of order', async () => {
    const candidates = [SAMPLE_CANDIDATE, { ...SAMPLE_CANDIDATE, opportunityId: 'opp-xyz' }];

    global.fetch = mock(async () =>
      new Response(JSON.stringify({ opportunities: candidates }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    ) as unknown as typeof fetch;

    const fake1 = buildFakeApi();
    await handleOpportunityBatch(fake1.api, BASE_URL, AGENT_ID, API_KEY);

    _resetForTesting();

    global.fetch = mock(async () =>
      new Response(JSON.stringify({ opportunities: [...candidates].reverse() }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    ) as unknown as typeof fetch;

    const fake2 = buildFakeApi();
    await handleOpportunityBatch(fake2.api, BASE_URL, AGENT_ID, API_KEY);

    expect(fake1.subagentCalls[0].idempotencyKey).toBe(fake2.subagentCalls[0].idempotencyKey);
  });

  test('calls /api/agents/:agentId/opportunities/pending with GET', async () => {
    const fetchCalls: Array<{ url: string; init?: RequestInit }> = [];
    global.fetch = mock(async (url: string | URL | Request, init?: RequestInit) => {
      fetchCalls.push({ url: String(url), init });
      return new Response(JSON.stringify({ opportunities: [] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }) as unknown as typeof fetch;

    const fake = buildFakeApi();
    await handleOpportunityBatch(fake.api, BASE_URL, AGENT_ID, API_KEY);

    expect(fetchCalls).toHaveLength(1);
    expect(fetchCalls[0].url).toContain(`/agents/${AGENT_ID}/opportunities/pending`);
    expect(fetchCalls[0].init?.method).toBe('GET');
  });
});
