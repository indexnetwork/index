import { MockLanguageModelV3 } from 'ai/test';
import { wake } from './wake.ts';
import { describe, expect, test } from 'bun:test';
import { negotiationScope, opportunityFromScope, type Index, type ConversationMessage, type NegotiationDetail, type PrincipalMessage } from '@indexnetwork/client';
import { expireUnanswered, latestBriefs, owedWork, readConversation, runNegotiate, toOpportunity } from './host.ts';
import type { Intent } from './types.ts';

const id = '11111111-1111-4111-8111-111111111111';
const scope = negotiationScope(null, id);
const context: Intent = { id: scope, kind: 'identity', opportunityId: id, statement: '' };
const match = { opportunityId: id, counterparty: { id: 'sender', name: 'Sender' } };

function fixture() {
  const messages: ConversationMessage[] = [];
  function append(text: string, metadata: object) {
    const row = { id: crypto.randomUUID(), createdAt: new Date().toISOString(), conversationId: 'dm', senderId: 'agent', role: 'agent' as const, parts: [{ kind: 'text', text }], metadata: { principalMessage: metadata } };
    messages.push(row);
    return row.id;
  }
  append('Use confirmed profile facts; availability is unknown.', { kind: 'message', record: 'brief', matches: [match] });
  append('continue', { kind: 'message', record: 'decision', matches: [match] });
  const detail = {
    opportunityId: id, intentId: null, awaitingUserId: 'recipient', settledAt: null, turnCount: 1,
    outcome: null, turns: [{ turnIndex: 0, seatUserId: 'sender', action: 'propose', message: 'Discuss advising?', createdAt: new Date().toISOString() }],
    counterparty: { intentId: 'sender-intent', userId: 'sender', name: 'Sender', statement: 'Looking for an advisor.', bio: null, location: null },
    protocol: { maxTurns: 10, remainingTurns: 9, availableActions: ['counter', 'accept', 'decline'] },
  } as NegotiationDetail;
  const submitted: unknown[] = [];
  const client = {
    me: async () => ({ id: 'recipient', name: 'Recipient', profileConfirmed: true }),
    getNegotiation: async () => detail,
    listIntents: async () => [],
    listIntentNegotiations: async (value: string) => { expect(value).toBe(scope); return [detail]; },
    principalInbox: async (value: string) => { expect(value).toBe(scope); return { conversationId: 'dm', messages }; },
    sendPrincipal: async (value: string, entries: PrincipalMessage[]) => {
      expect(value).toBe(scope);
      for (const { id: entryId, text, ...metadata } of entries) {
        append(text, metadata);
        messages.at(-1)!.id = entryId;
      }
    },
    submitTurn: async (_id: string, turn: unknown) => { submitted.push(turn); return detail; },
  } as unknown as Index;
  return { client, messages, detail, submitted, append };
}

describe('identity recipient compatibility', () => {
  test('scopes cannot be confused with intent IDs or malformed references', () => {
    expect(opportunityFromScope(scope)).toBe(id);
    expect(negotiationScope('intent', id)).toBe('intent');
    expect(opportunityFromScope('opportunity:invalid')).toBeNull();
    expect(opportunityFromScope(id)).toBeNull();
  });

  test('a zero-intent recipient takes the ordinary negotiation turn', async () => {
    const f = fixture();
    const result = await runNegotiate(f.client, id, context, { model: {} as never, negotiate: async (input) => {
      expect(input.intent.kind).toBe('identity');
      expect(input.intent.statement).toBe('');
      expect(input.user.id).toBe('recipient');
      expect(input.opportunity.intent?.statement).toBe('Looking for an advisor.');
      return { turn: { action: 'counter', message: 'What advice would be useful?' } };
    } });
    expect(f.submitted).toEqual([{ action: 'counter', message: 'What advice would be useful?' }]);
    expect('turn' in result).toBe(true);
  });

  test('stalls hold, answers release through the existing decision, and retry can continue', async () => {
    const f = fixture();
    await runNegotiate(f.client, id, context, { model: {} as never, negotiate: async () => ({ stall: { reason: 'Availability unknown.', suggestedAsk: 'Are you available to advise?' } }) });
    let owed = await owedWork(f.client, context);
    expect(owed).toEqual({ wake: true, negotiate: [] });
    const stall = latestBriefs(readConversation(f.messages)).get(id)!.stall!;
    const q = 'question';
    f.append('Are you available to advise?', { kind: 'question', questionId: q, matches: [match], stalls: [stall.id] });
    const held = await runNegotiate(f.client, id, context, { model: {} as never, negotiate: async () => { throw new Error('must stay held'); } });
    expect('held' in held).toBe(true);
    expect((await owedWork(f.client, context)).wake).toBe(false);
    f.append('Yes.', { kind: 'answer', questionId: q, matches: [match] });
    expect((await owedWork(f.client, context)).wake).toBe(true);
    f.append('Recipient confirmed availability.', { kind: 'message', record: 'brief', matches: [match] });
    f.append('continue', { kind: 'message', record: 'decision', matches: [match] });
    owed = await owedWork(f.client, context);
    expect(owed).toEqual({ wake: false, negotiate: [id] });
    await runNegotiate(f.client, id, context, { model: {} as never, negotiate: async () => ({ turn: { action: 'accept', message: 'A conversation would be useful.' } }) });
    expect(f.submitted).toHaveLength(1);
  });

  test('expired questions release identity-scoped stalls without fabricating an answer', async () => {
    const f = fixture();
    const stallId = f.append('Availability unknown.', { kind: 'message', record: 'stall', stall: { turnCount: 1 }, matches: [match] });
    f.append('Available?', { kind: 'question', questionId: 'q', matches: [match], stalls: [stallId] });
    expect(await expireUnanswered(f.client, context, new Set(['q']))).toEqual([id]);
    expect(latestBriefs(readConversation(f.messages)).get(id)?.brief).toContain('did not answer');
  });

  test('another opportunity context cannot take the recipient seat', async () => {
    const f = fixture();
    f.client.principalInbox = async () => ({ conversationId: 'dm', messages: [] });
    const result = await runNegotiate(f.client, id, { ...context, id: 'opportunity:22222222-2222-4222-8222-222222222222' }, { model: {} as never });
    expect('stall' in result).toBe(true);
    expect(f.submitted).toHaveLength(0);
  });

  test('an identity counterpart is represented without an invented statement', () => {
    const f = fixture();
    f.detail.counterparty.intentId = null;
    f.detail.counterparty.statement = '';
    expect(toOpportunity(f.detail, 'recipient').intent).toBeUndefined();
  });
});


test('an identity wake has the ordinary tools but cannot discover or fabricate an intent', async () => {
  const model = new MockLanguageModelV3({ doGenerate: async (input) => {
    expect(input.tools?.some((tool) => tool.name === 'ask_principal')).toBe(true);
    expect(input.tools?.some((tool) => tool.name === 'reach_counterparties')).toBe(false);
    const system = input.prompt.find((message) => message.role === 'system');
    expect(system?.content).toContain('Your principal has no intent attached');
    expect(system?.content).not.toContain('Current intent:');
    return {
      content: [{ type: 'text', text: 'Nothing to do.' }], finishReason: { unified: 'stop', raw: 'stop' },
      usage: { inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 }, outputTokens: { total: 1, text: 1, reasoning: 0 } }, warnings: [],
    };
  } });
  const client = { discover: async () => { throw new Error('Identity discovery is outside v1'); }, createIntent: async () => { throw new Error('No synthetic intent'); } } as unknown as Index;
  await wake({ user: { id: 'recipient', name: 'Recipient' }, intent: context, opportunities: [], principalConversation: [], model, client });
  expect(model.doGenerateCalls).toHaveLength(1);
});
