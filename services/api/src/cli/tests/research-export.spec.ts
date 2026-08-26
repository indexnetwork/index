import { describe, expect, it } from 'bun:test';

import { hmacId, redactText, uniqueTerms } from '../research-export/anonymize';
import { buildDictionary, buildMetrics, extractTurn, transformIntents, transformNegotiations, transformOpportunities, transformUsers } from '../research-export/transform';

const SECRET = 'test-research-hmac-secret';
const USER_A = '11111111-1111-4111-8111-111111111111';
const USER_B = '22222222-2222-4222-8222-222222222222';
const INTENT_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const OPP_A = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const CONV_A = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

describe('research export anonymize', () => {
  it('produces stable HMAC pseudonyms and never echoes raw ids', () => {
    const first = hmacId(SECRET, 'user', USER_A);
    const second = hmacId(SECRET, 'user', USER_A);
    expect(first).toBe(second);
    expect(first.startsWith('user_')).toBe(true);
    expect(first).not.toContain(USER_A);
    expect(hmacId(SECRET, 'user', USER_B)).not.toBe(first);
    expect(hmacId('other-secret', 'user', USER_A)).not.toBe(first);
  });

  it('redacts names, emails, handles, phones, urls, credentials, and UUIDs', () => {
    const named = redactText('Ada Lovelace visited London', uniqueTerms(['Ada Lovelace']));
    expect(named).toBe('[PERSON] visited London');

    const patterned = redactText(
      `email ada@example.com handle @ada_codes url https://linkedin.com/in/ada secret idxh_abc12345SECRET uuid ${USER_A} phone 415-555-0100`,
      [],
    );
    expect(patterned).not.toMatch(/ada@example.com/i);
    expect(patterned).not.toMatch(/@ada_codes/i);
    expect(patterned).not.toMatch(/linkedin\.com/);
    expect(patterned).not.toMatch(/idxh_/);
    expect(patterned).not.toMatch(/11111111-1111-4111-8111-111111111111/);
    expect(patterned).not.toMatch(/415-555-0100/);
    expect(patterned).toContain('[EMAIL]');
    expect(patterned).toContain('[HANDLE]');
    expect(patterned).toContain('[URL]');
    expect(patterned).toContain('[CREDENTIAL]');
    expect(patterned).toContain('[PHONE]');
  });
});

describe('research export transform', () => {
  const users = [
    {
      id: USER_A,
      name: 'Ada Lovelace',
      email: 'ada@example.com',
      key: 'ada',
      intro: 'Mathematician in London',
      onboarding: { profileSeeds: [{ name: 'Ada Lovelace', bio: 'Born in 1815', socials: [{ label: 'x', value: '@ada_codes' }] }] },
      createdAt: new Date('2026-06-01T00:00:00Z'),
      deletedAt: null,
    },
    {
      id: USER_B,
      name: 'Charles Babbage',
      email: 'charles@example.com',
      key: null,
      intro: null,
      onboarding: {},
      createdAt: new Date('2026-06-02T00:00:00Z'),
      deletedAt: new Date('2026-07-01T00:00:00Z'),
    },
  ];
  const terms = buildDictionary({
    users,
    socials: [{ userId: USER_A, value: 'https://github.com/ada' }],
    telegramChatIds: ['999888777'],
  });

  it('builds a dictionary from profile fields and drops identity from users.jsonl', () => {
    expect(terms.some((term) => /ada lovelace/i.test(term))).toBe(true);
    const rows = transformUsers(SECRET, users);
    expect(rows).toEqual([
      { user_id: hmacId(SECRET, 'user', USER_A), created_at: Date.parse('2026-06-01T00:00:00Z') / 1000, deleted: false },
      { user_id: hmacId(SECRET, 'user', USER_B), created_at: Date.parse('2026-06-02T00:00:00Z') / 1000, deleted: true },
    ]);
    expect(JSON.stringify(rows)).not.toMatch(/ada@example.com/i);
    expect(JSON.stringify(rows)).not.toMatch(/Lovelace/);
  });

  it('redacts intent text and opportunity reasoning', () => {
    const intents = transformIntents(SECRET, [{
      id: INTENT_A,
      userId: USER_A,
      payload: 'Ada Lovelace wants to meet founders at ada@example.com',
      summary: 'Meet founders',
      status: 'ACTIVE',
      isIncognito: false,
      createdAt: new Date('2026-06-03T00:00:00Z'),
      updatedAt: new Date('2026-06-03T00:00:00Z'),
      archivedAt: null,
    }], terms);
    expect(intents[0].payload).not.toMatch(/Ada Lovelace/i);
    expect(intents[0].payload).not.toMatch(/ada@example.com/i);
    expect(intents[0].user_id).toBe(hmacId(SECRET, 'user', USER_A));

    const opportunities = transformOpportunities(SECRET, [{
      id: OPP_A,
      detection: { source: 'opportunity_graph', triggeredBy: INTENT_A, createdByName: 'Ada Lovelace' } as { source?: string; triggeredBy?: string },
      actors: [{ userId: USER_A, intent: INTENT_A, role: 'patient', actedAt: '2026-06-04T00:00:00.000Z', networkId: 'net-1' }],
      interpretation: { category: 'collaboration', reasoning: 'Ada Lovelace is a strong match with uuid ' + USER_B },
      context: { networkId: 'net-1' },
      confidence: '80',
      status: 'accepted',
      acceptedBy: USER_A,
      createdAt: new Date('2026-06-03T00:00:00Z'),
      updatedAt: new Date('2026-06-04T00:00:00Z'),
      expiresAt: null,
    }], terms);
    expect(JSON.stringify(opportunities)).not.toContain('createdByName');
    expect(opportunities[0].reasoning).not.toMatch(/Ada Lovelace/i);
    expect(opportunities[0].reasoning).not.toContain(USER_B);
    expect(opportunities[0].accepted_by).toBe(hmacId(SECRET, 'user', USER_A));
    expect(opportunities[0].status).toBe('accepted');
  });

  it('extracts A2A turns, strips pause payloads, and sorts messages onto seq', () => {
    expect(extractTurn([{ kind: 'data', data: { verb: 'outreach', message: 'Hello Ada Lovelace', reasoning: 'Opening.' } }])).toEqual({
      verb: 'outreach',
      text: 'Hello Ada Lovelace\nOpening.',
    });
    expect(extractTurn([{ kind: 'data', data: { verb: 'pause', reason: 'needs_principal', payload: { question: 'What is Ada budget?' } } }])).toEqual({
      verb: 'pause',
      text: 'pause:needs_principal',
    });

    const negotiations = transformNegotiations(
      SECRET,
      [{
        id: 'task-1',
        conversationId: CONV_A,
        state: 'completed',
        createdAt: new Date('2026-06-05T00:00:00Z'),
        metadata: { opportunityId: OPP_A, sourceUserId: USER_A, candidateUserId: USER_B, networkId: 'net-1' },
      }],
      [
        {
          id: 'm2',
          taskId: 'task-1',
          senderId: `agent:${USER_B}`,
          createdAt: new Date('2026-06-05T00:00:10Z'),
          parts: [{ kind: 'data', data: { verb: 'counter', message: 'Ada Lovelace is busy', reasoning: 'Push back.' } }],
        },
        {
          id: 'm1',
          taskId: 'task-1',
          senderId: `agent:${USER_A}`,
          createdAt: new Date('2026-06-05T00:00:00Z'),
          parts: [{ kind: 'data', data: { verb: 'outreach', message: 'Hello from ada@example.com', reasoning: 'Open.' } }],
        },
      ],
      [{
        taskId: 'task-1',
        name: 'negotiation-outcome',
        parts: [{ kind: 'data', data: { hasOpportunity: false, reason: 'screened_out', reasoning: 'Ada Lovelace is fundraising.' } }],
      }],
      terms,
    );

    expect(negotiations[0].messages.map((message) => message.seq)).toEqual([0, 1]);
    expect(negotiations[0].messages[0].verb).toBe('outreach');
    expect(negotiations[0].messages[0].role).toBe('agent');
    expect(negotiations[0].messages[1].speaker_user_id).toBe(hmacId(SECRET, 'user', USER_B));
    expect(JSON.stringify(negotiations)).not.toMatch(/Ada Lovelace/i);
    expect(JSON.stringify(negotiations)).not.toMatch(/ada@example.com/i);
    expect(JSON.stringify(negotiations)).not.toContain('payload');
    expect(negotiations[0].outcome_reason).toBe('screened_out');
    expect(negotiations[0].conversation_id).toBe(hmacId(SECRET, 'session', CONV_A));
  });

  it('counts accepted, rejected, and screened-out metrics', () => {
    const metrics = buildMetrics({
      networkTitle: 'Edge Esmeralda 2026',
      networkIdKind: 'network',
      networkRawId: 'net-1',
      secret: SECRET,
      users: transformUsers(SECRET, users),
      intents: [],
      opportunities: [
        { status: 'accepted', actors: [{ acted_at: 'x' }] },
        { status: 'rejected', actors: [{ acted_at: null }] },
        { status: 'pending', actors: [] },
      ] as ReturnType<typeof transformOpportunities>,
      negotiations: [
        { task_state: 'completed', outcome_reason: 'screened_out', outcome_has_opportunity: false, messages: [] },
        { task_state: 'completed', outcome_reason: null, outcome_has_opportunity: true, messages: [{ verb: 'outreach', text: 'hi' }] },
        { task_state: 'paused', outcome_reason: null, outcome_has_opportunity: null, messages: [{ verb: 'pause', text: 'pause:turn_cap' }] },
      ] as ReturnType<typeof transformNegotiations>,
    });
    expect(metrics.opportunities_by_status).toEqual({ accepted: 1, rejected: 1, pending: 1 });
    expect(metrics.negotiations_screened_out).toBe(1);
    expect(metrics.negotiation_continue_turns).toBe(1);
    expect(metrics.negotiation_pauses_by_reason).toEqual({ turn_cap: 1 });
    expect(metrics.users).toBe(2);
  });
});
