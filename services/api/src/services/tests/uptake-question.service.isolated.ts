import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test';

import type { OpportunityRow } from '../../adapters/database.shared';
import { UptakeQuestionService, type UptakeQuestionServiceDeps } from '../uptake-question.service';

const RECIPIENT = 'recipient';
const COUNTERPARTY = 'counterparty';
const INTRODUCER = 'introducer';
const NETWORK = 'network';
const INTENT = 'intent';
const RECIPIENT_INTENT = 'recipient-intent';
const OPPORTUNITY = 'opportunity';

function opportunity(overrides?: Partial<OpportunityRow>): OpportunityRow {
  return {
    id: OPPORTUNITY,
    detection: { source: 'manual', timestamp: new Date().toISOString() },
    actors: [
      { userId: RECIPIENT, networkId: NETWORK, role: 'patient', intent: RECIPIENT_INTENT },
      { userId: COUNTERPARTY, networkId: NETWORK, role: 'peer', intent: INTENT },
      { userId: INTRODUCER, networkId: NETWORK, role: 'introducer' },
    ],
    interpretation: { category: 'collaboration', reasoning: 'private reasoning', confidence: 0.8 },
    context: { networkId: NETWORK },
    confidence: '0.8',
    status: 'pending',
    createdAt: new Date(),
    updatedAt: new Date(),
    expiresAt: null,
    metadata: null,
    ...overrides,
  };
}

function makeDeps(overrides?: Partial<UptakeQuestionServiceDeps>) {
  const enqueue = mock(async () => {});
  const deps: UptakeQuestionServiceDeps = {
    getOpportunity: async () => opportunity(),
    getIntent: async (id) => id === RECIPIENT_INTENT
      ? {
          id,
          userId: RECIPIENT,
          payload: 'Find practical collaborators',
          summary: 'Find collaborators',
          status: 'ACTIVE',
          archivedAt: null,
          felicityAuthority: 100,
        }
      : {
          id: INTENT,
          userId: COUNTERPARTY,
          payload: 'Host a hands-on TypeScript workshop',
          summary: 'Host a TypeScript workshop',
          status: 'ACTIVE',
          archivedAt: null,
          felicityAuthority: 45,
        },
    resolveSafeCommonNetwork: async () => ({ id: NETWORK, title: 'Builders Community' }),
    hasQuestionForRecipientSourcePurpose: async () => false,
    enqueue,
    ...overrides,
  };
  return { deps, enqueue, service: new UptakeQuestionService(deps) };
}

beforeEach(() => {
  process.env.QUESTIONER_ENABLED = 'true';
  process.env.QUESTIONER_UPTAKE_ENABLED = 'true';
  process.env.QUESTIONER_UPTAKE_AUTHORITY_THRESHOLD = '70';
});

afterEach(() => {
  delete process.env.QUESTIONER_ENABLED;
  delete process.env.QUESTIONER_UPTAKE_ENABLED;
  delete process.env.QUESTIONER_UPTAKE_AUTHORITY_THRESHOLD;
});

describe('UptakeQuestionService', () => {
  it('is disabled by default and only enqueues a network-scoped low-authority counterparty intent', async () => {
    const getIntent = mock(async (id: string) => id === RECIPIENT_INTENT
      ? {
          id, userId: RECIPIENT, payload: 'Find collaborators', summary: null,
          status: 'ACTIVE', archivedAt: null, felicityAuthority: 100,
        }
      : {
          id, userId: COUNTERPARTY, payload: 'Host a hands-on TypeScript workshop',
          summary: 'Host a TypeScript workshop', status: 'ACTIVE', archivedAt: null,
          felicityAuthority: 45,
        });
    const { service, enqueue } = makeDeps({ getIntent });
    await service.handlePending(OPPORTUNITY);
    expect(getIntent).toHaveBeenCalledWith(RECIPIENT_INTENT, NETWORK);
    expect(getIntent).toHaveBeenCalledWith(INTENT, NETWORK);
    expect(enqueue).toHaveBeenCalledTimes(1);
    const [input, jobId] = enqueue.mock.calls[0];
    expect(input).toMatchObject({
      mode: 'negotiation',
      purpose: 'uptake',
      userId: RECIPIENT,
      sourceType: 'opportunity',
      sourceId: OPPORTUNITY,
      scopeType: 'network',
      scopeId: NETWORK,
      negotiation: {
        purpose: 'uptake',
        recipientUserId: RECIPIENT,
        recipientIntentId: RECIPIENT_INTENT,
        opportunityId: OPPORTUNITY,
        networkId: NETWORK,
        counterpartyUserId: COUNTERPARTY,
        counterpartyIntentId: INTENT,
      },
      context: {
        purpose: 'uptake',
        negotiationId: OPPORTUNITY,
        counterpartyHint: 'the other participant',
        indexContext: 'the selected network',
        proposedActivity: 'a potential collaboration that may require clarification before you decide',
      },
    });
    expect(JSON.stringify(input)).not.toContain('45');
    expect(JSON.stringify(input)).not.toContain('private reasoning');
    expect(JSON.stringify(input)).not.toContain('Open-source maintainer');
    expect(JSON.stringify(input)).not.toContain('Berlin');
    expect(JSON.stringify(input)).not.toContain('TypeScript workshop');
    expect(JSON.stringify(input)).not.toContain('Builders Community');
    expect(jobId).toBe(`uptake-${RECIPIENT}-${OPPORTUNITY}`);
  });

  it('skips legacy blank and null-like actor intents without an intent lookup', async () => {
    const nullLikeValues: unknown[] = [null, undefined, '', '   ', 'null', ' NULL ', 'undefined'];

    for (const intent of nullLikeValues) {
      const getIntent = mock(async () => null);
      const { service, enqueue } = makeDeps({
        getOpportunity: async () => opportunity({
          actors: [
            { userId: RECIPIENT, networkId: NETWORK, role: 'patient', intent: RECIPIENT_INTENT },
            { userId: COUNTERPARTY, networkId: NETWORK, role: 'peer', intent } as never,
          ],
        }),
        getIntent,
      });

      await service.handlePending(OPPORTUNITY);

      expect(getIntent).not.toHaveBeenCalled();
      expect(enqueue).not.toHaveBeenCalled();
    }
  });

  it('trims a valid non-UUID actor intent before the exact lookup', async () => {
    const getIntent = mock(async (intentId: string) => ({
      id: intentId,
      userId: intentId === RECIPIENT_INTENT ? RECIPIENT : COUNTERPARTY,
      payload: intentId === RECIPIENT_INTENT ? 'Find collaborators' : 'Host a hands-on TypeScript workshop',
      summary: intentId === RECIPIENT_INTENT ? null : 'Host a TypeScript workshop',
      status: 'ACTIVE' as const,
      archivedAt: null,
      felicityAuthority: intentId === RECIPIENT_INTENT ? 100 : 45,
    }));
    const { service, enqueue } = makeDeps({
      getOpportunity: async () => opportunity({
        actors: [
          { userId: RECIPIENT, networkId: NETWORK, role: 'patient', intent: RECIPIENT_INTENT },
          { userId: COUNTERPARTY, networkId: NETWORK, role: 'peer', intent: `  ${INTENT}  ` },
        ],
      }),
      getIntent,
    });

    await service.handlePending(OPPORTUNITY);

    expect(getIntent).toHaveBeenCalledWith(INTENT, NETWORK);
    expect(enqueue).toHaveBeenCalledTimes(1);
  });

  it('skips high or unknown authority', async () => {
    for (const felicityAuthority of [70, null]) {
      const { service, enqueue } = makeDeps({
        getIntent: async (id) => id === RECIPIENT_INTENT
          ? { id, userId: RECIPIENT, payload: 'Find collaborators', summary: null, status: 'ACTIVE', archivedAt: null, felicityAuthority: 100 }
          : { id, userId: COUNTERPARTY, payload: 'Activity', summary: null, status: 'ACTIVE', archivedAt: null, felicityAuthority },
      });
      await service.handlePending(OPPORTUNITY);
      expect(enqueue).not.toHaveBeenCalled();
    }
  });

  it('skips mismatched owner, inactive, or archived intents', async () => {
    const variants = [
      { userId: 'wrong-owner', status: 'ACTIVE', archivedAt: null },
      { userId: COUNTERPARTY, status: 'PAUSED', archivedAt: null },
      { userId: COUNTERPARTY, status: 'ACTIVE', archivedAt: new Date() },
    ];
    for (const variant of variants) {
      const { service, enqueue } = makeDeps({
        getIntent: async (id) => id === RECIPIENT_INTENT
          ? { id, userId: RECIPIENT, payload: 'Find collaborators', summary: null, status: 'ACTIVE', archivedAt: null, felicityAuthority: 100 }
          : { id, payload: 'Activity', summary: null, felicityAuthority: 20, ...variant },
      });
      await service.handlePending(OPPORTUNITY);
      expect(enqueue).not.toHaveBeenCalled();
    }
  });

  it('skips foreign, paused, archived, or unassigned recipient intents', async () => {
    const variants = [
      { userId: 'wrong-owner', status: 'ACTIVE', archivedAt: null },
      { userId: RECIPIENT, status: 'PAUSED', archivedAt: null },
      { userId: RECIPIENT, status: 'ACTIVE', archivedAt: new Date() },
      null,
    ];
    for (const variant of variants) {
      const { service, enqueue } = makeDeps({
        getIntent: async (id) => id === RECIPIENT_INTENT
          ? (variant && { id, payload: 'Find collaborators', summary: null, felicityAuthority: 100, ...variant })
          : { id, userId: COUNTERPARTY, payload: 'Activity', summary: null, status: 'ACTIVE', archivedAt: null, felicityAuthority: 20 },
      });
      await service.handlePending(OPPORTUNITY);
      expect(enqueue).not.toHaveBeenCalled();
    }
  });

  it('fails closed on ambiguous duplicate actor bindings', async () => {
    const { service, enqueue } = makeDeps({
      getOpportunity: async () => opportunity({
        actors: [
          { userId: RECIPIENT, networkId: 'other-network', role: 'patient', intent: RECIPIENT_INTENT },
          { userId: RECIPIENT, networkId: NETWORK, role: 'patient', intent: RECIPIENT_INTENT },
          { userId: COUNTERPARTY, networkId: 'other-network', role: 'peer' },
          { userId: COUNTERPARTY, networkId: NETWORK, role: 'peer', intent: INTENT },
        ],
      }),
    });

    await service.handlePending(OPPORTUNITY);
    expect(enqueue).not.toHaveBeenCalled();
  });

  it('skips unsafe network anchors, introducers, acted recipients, and duplicates', async () => {
    const unsafe = makeDeps({ resolveSafeCommonNetwork: async () => null });
    await unsafe.service.handlePending(OPPORTUNITY);
    expect(unsafe.enqueue).not.toHaveBeenCalled();

    const duplicate = makeDeps({ hasQuestionForRecipientSourcePurpose: async () => true });
    await duplicate.service.handlePending(OPPORTUNITY);
    expect(duplicate.enqueue).not.toHaveBeenCalled();

    const acted = makeDeps({
      getOpportunity: async () => opportunity({
        actors: [
          { userId: RECIPIENT, networkId: NETWORK, role: 'patient', intent: RECIPIENT_INTENT, actedAt: new Date().toISOString() },
          { userId: COUNTERPARTY, networkId: NETWORK, role: 'peer', intent: INTENT },
        ],
      }),
    });
    await acted.service.handlePending(OPPORTUNITY);
    expect(acted.enqueue).not.toHaveBeenCalled();
  });

  it('fails open on lookup and enqueue failures', async () => {
    const lookup = makeDeps({ getOpportunity: async () => { throw new Error('db down'); } });
    await expect(lookup.service.handlePending(OPPORTUNITY)).resolves.toBeUndefined();

    const enqueue = makeDeps({ enqueue: async () => { throw new Error('redis down'); } });
    await expect(enqueue.service.handlePending(OPPORTUNITY)).resolves.toBeUndefined();
  });
});
