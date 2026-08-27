/**
 * IND-406 — NegotiationReflectQueue job handlers (unit tests, deps injected).
 *
 * Pins:
 * - `reflect`: flag off → distiller never invoked; flag on → BOTH sides get a
 *   reflection pass with perspective-projected transcripts and correct seat
 *   attribution; one side failing never costs the other its memories,
 * - `chat_reflect`: ownership guard (only the canonical signal DM reflects),
 *   counterparty_dossier entries are dropped (no subject in chat scope),
 *   sessions without client messages are skipped.
 */
process.env.DATABASE_URL = process.env.DATABASE_URL ?? 'postgresql://unused:unused@localhost:5432/unused';
process.env.OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY ?? 'test-key';

import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test';

import type { NegotiationReflectionInput, ChatReflectionInput, DistilledMemory } from '@indexnetwork/protocol';

import { NegotiationReflectQueue, type ReflectJobData } from '../negotiations/reflect.queue';


/** #1494: persisted turn shape is {verb, message, reasoning} — not the pre-rewrite {action, assessment}. */
function turnMessage(senderUserId: string, verb: string, message?: string): {
  id: string; senderId: string; parts: unknown[]; createdAt: Date;
} {
  return {
    id: `msg-${verb}-${senderUserId}`,
    senderId: `agent:${senderUserId}`,
    parts: [{ kind: 'data', data: { verb, ...(message && { message }), reasoning: `${verb} reasoning` } }],
    createdAt: new Date(),
  };
}

const reflectJob: ReflectJobData = {
  negotiationId: 'neg-1',
  conversationId: 'conv-1',
  opportunityId: 'opp-1',
  sourceUser: { id: 'u-alice', name: 'Alice' },
  candidateUser: { id: 'u-bob', name: 'Bob' },
  initiatorUserId: 'u-alice',
  outcome: { hasOpportunity: true, reasoning: 'aligned', turnCount: 2 },
};

const distilled: DistilledMemory[] = [{
  kind: 'playbook',
  content: 'x',
  confidence: 0.5,
  aboutCounterparty: false,
  turnIndexes: [0],
}];

function mkQueue(opts?: {
  reflectNegotiation?: (input: NegotiationReflectionInput) => Promise<DistilledMemory[]>;
  reflectChat?: (input: ChatReflectionInput) => Promise<DistilledMemory[]>;
  session?: { persona: string; scopeType: string | null; scopeId: string | null } | null;
  canonicalDmId?: string | null;
  chatMessages?: Array<{ role: 'user' | 'assistant' | 'system'; content: string }>;
  negotiationMessages?: Array<{ id: string; senderId: string; parts: unknown[]; createdAt: Date }>;
}) {
  const reflectCalls: NegotiationReflectionInput[] = [];
  const chatCalls: ChatReflectionInput[] = [];
  const writes: Array<Record<string, unknown>> = [];

  const queue = new NegotiationReflectQueue({
    conversations: {
      // #1494: a negotiation is its own conversation now, not a pair-shared
      // one — the worker reads the negotiation's own conversation directly,
      // no negotiation-scoped/conversation-scoped distinction left to make.
      getMessagesForConversation: async () => opts?.negotiationMessages ?? [
        turnMessage('u-alice', 'outreach', 'hello'),
        turnMessage('u-bob', 'accept', 'deal'),
      ],
    },
    chat: {
      getSession: async () => opts?.session === undefined ? { persona: 'personal', scopeType: 'intent', scopeId: 'intent-1' } : opts.session,
      findNegotiatorIntentSessionId: async () => opts?.canonicalDmId === undefined ? 'sess-1' : opts.canonicalDmId,
      getSessionMessages: async () => opts?.chatMessages ?? [
        { role: 'user', content: 'never share my rate' },
        { role: 'assistant', content: 'understood' },
      ],
    },
    reflector: {
      reflectNegotiation: mock(async (input: NegotiationReflectionInput) => {
        reflectCalls.push(input);
        return opts?.reflectNegotiation ? opts.reflectNegotiation(input) : distilled;
      }),
      reflectChat: mock(async (input: ChatReflectionInput) => {
        chatCalls.push(input);
        return opts?.reflectChat ? opts.reflectChat(input) : distilled;
      }),
    },
    writer: {
      writeDistilledMemories: mock(async (input: Record<string, unknown>) => {
        writes.push(input);
        return { written: (input.entries as unknown[]).length, skipped: 0 };
      }) as never,
      runConfidenceDecay: mock(async () => ({ decayed: 0, deleted: 0 })),
    },
  });

  return { queue, reflectCalls, chatCalls, writes };
}

describe('NegotiationReflectQueue', () => {
  const queues: NegotiationReflectQueue[] = [];

  beforeEach(() => {
  });

  afterEach(async () => {
    await Promise.all(queues.splice(0).map((q) => q.close().catch(() => undefined)));
  });

  describe('reflect', () => {
    it('runs one perspective-projected pass per side with correct seat attribution', async () => {
      const { queue, reflectCalls, writes } = mkQueue();
      queues.push(queue);

      await queue.processJob('reflect', reflectJob);

      expect(reflectCalls.length).toBe(2);

      // Alice's pass: she spoke turn 0, holds the initiator seat.
      const alicePass = reflectCalls.find((c) => c.clientUser.id === 'u-alice')!;
      expect(alicePass.seat).toBe('initiator');
      expect(alicePass.counterpartyUser.id).toBe('u-bob');
      // Each side reflects on its own reasoning and on what the other side
      // actually said — never on why the other side said it.
      expect(alicePass.transcript).toEqual([
        { index: 0, speaker: 'client', action: 'outreach', message: 'hello', reasoning: 'outreach reasoning' },
        { index: 1, speaker: 'counterparty', action: 'accept', message: 'deal' },
      ]);

      // Bob's pass: same transcript, flipped perspective, counterparty seat —
      // so the reasoning that is his to keep flips with it.
      const bobPass = reflectCalls.find((c) => c.clientUser.id === 'u-bob')!;
      expect(bobPass.seat).toBe('counterparty');
      expect(bobPass.transcript[0].speaker).toBe('counterparty');
      expect(bobPass.transcript[0]).not.toHaveProperty('reasoning');
      expect(bobPass.transcript[1].speaker).toBe('client');
      expect(bobPass.transcript[1].reasoning).toBe('accept reasoning');

      // Both sides write with negotiation provenance and the counterparty as dossier subject.
      expect(writes.length).toBe(2);
      expect(writes[0]).toMatchObject({
        userId: 'u-alice',
        counterpartyUserId: 'u-bob',
        sourceRef: { type: 'negotiation', id: 'neg-1' },
      });
      expect(writes[1]).toMatchObject({ userId: 'u-bob', counterpartyUserId: 'u-alice' });
    });

    it('one side failing never costs the other its memories', async () => {
      const { queue, writes } = mkQueue({
        reflectNegotiation: async (input) => {
          if (input.clientUser.id === 'u-alice') throw new Error('LLM timeout');
          return distilled;
        },
      });
      queues.push(queue);

      await queue.processJob('reflect', reflectJob);

      expect(writes.length).toBe(1);
      expect(writes[0]).toMatchObject({ userId: 'u-bob' });
    });

    it('projects a pause turn as pause:<reason>, not the pre-rewrite {action,assessment} shape (#1494 round-3 cap-cut d)', async () => {
      const { queue, reflectCalls } = mkQueue({
        negotiationMessages: [
          turnMessage('u-alice', 'outreach', 'hello'),
          {
            id: 'msg-pause',
            senderId: 'agent:u-bob',
            parts: [{ kind: 'data', data: { verb: 'pause', reason: 'needs_principal' } }],
            createdAt: new Date(),
          },
        ],
      });
      queues.push(queue);

      await queue.processJob('reflect', reflectJob);

      const alicePass = reflectCalls.find((c) => c.clientUser.id === 'u-alice')!;
      expect(alicePass.transcript[1]).toMatchObject({ action: 'pause:needs_principal', speaker: 'counterparty' });
    });
  });

  describe('chat_reflect', () => {
    const chatJob = { sessionId: 'sess-1', userId: 'u-alice' };

    it('non-intent-scoped session → skipped (guard)', async () => {
      const { queue, chatCalls, writes } = mkQueue({ session: { persona: 'personal', scopeType: null, scopeId: null } });
      queues.push(queue);

      await queue.processJob('chat_reflect', chatJob);
      expect(chatCalls.length).toBe(0);
      expect(writes.length).toBe(0);
    });

    it('intent-scoped but not the canonical DM → skipped (guard)', async () => {
      // A pre-collapse pinned chat that lost the DM fold-in carries the
      // intent scope but no registry claim; it never distils.
      const { queue, chatCalls, writes } = mkQueue({ canonicalDmId: 'sess-other' });
      queues.push(queue);

      await queue.processJob('chat_reflect', chatJob);
      expect(chatCalls.length).toBe(0);
      expect(writes.length).toBe(0);
    });

    it('missing/unowned session → skipped (guard)', async () => {
      const { queue, chatCalls } = mkQueue({ session: null });
      queues.push(queue);

      await queue.processJob('chat_reflect', chatJob);
      expect(chatCalls.length).toBe(0);
    });

    it('no client messages → skipped', async () => {
      const { queue, chatCalls } = mkQueue({
        chatMessages: [{ role: 'assistant', content: 'hello, I am your negotiator' }],
      });
      queues.push(queue);

      await queue.processJob('chat_reflect', chatJob);
      expect(chatCalls.length).toBe(0);
    });

    it('distills the DM and writes with chat provenance; dossiers are dropped', async () => {
      const { queue, chatCalls, writes } = mkQueue({
        reflectChat: async () => [
          { kind: 'disclosure_rule', content: 'never share rate', confidence: 0.9, aboutCounterparty: false, turnIndexes: [0] },
          { kind: 'counterparty_dossier', content: 'should be dropped', confidence: 0.5, aboutCounterparty: true, turnIndexes: [] },
        ],
      });
      queues.push(queue);

      await queue.processJob('chat_reflect', chatJob);

      expect(chatCalls.length).toBe(1);
      expect(chatCalls[0].messages).toEqual([
        { role: 'user', content: 'never share my rate' },
        { role: 'assistant', content: 'understood' },
      ]);

      expect(writes.length).toBe(1);
      const entries = writes[0].entries as DistilledMemory[];
      expect(entries.length).toBe(1);
      expect(entries[0].kind).toBe('disclosure_rule');
      expect(writes[0]).toMatchObject({
        userId: 'u-alice',
        sourceRef: { type: 'chat', id: 'sess-1' },
      });
    });
  });
});
