/**
 * Integration tests for NegotiatorClientDmRetrievalAdapter (A2H read path).
 * Requires a live database connection (.env.test).
 *
 * Covers: the NEGOTIATOR_CLIENT_DM_INJECT flag gate, resolving a real excerpt
 * for a user who has a negotiator DM on that signal, [] for one who does not,
 * the recent-tail cap and its ordering, per-message truncation, and the two
 * isolations that make the seam safe — a different user's DM on the same
 * signal, and the same user's DM on a different signal, are both unreachable.
 */

import { config } from 'dotenv';
config({ path: '.env.test', override: true });

import { describe, it, expect, beforeAll, afterAll } from 'bun:test';
import { randomUUID } from 'crypto';

import { NegotiatorClientDmRetrievalAdapter } from '../negotiator-client-dm.retrieval.adapter';
import { ConversationDatabaseAdapter } from '../conversation.database.adapter';
import { db, inArray, schema, SYSTEM_AGENT_ID } from '../database.shared';

/** Mirrors MAX_DM_MESSAGES in the adapter — the recent-tail prompt budget. */
const MAX_DM_MESSAGES = 20;
/** Mirrors MAX_MESSAGE_CHARS in the adapter. */
const MAX_MESSAGE_CHARS = 1200;

describe('NegotiatorClientDmRetrievalAdapter', () => {
  const retrieval = new NegotiatorClientDmRetrievalAdapter();
  const conversations = new ConversationDatabaseAdapter();
  const run = randomUUID().slice(0, 8);

  let ownerId: string;
  let strangerId: string;
  const userIds: string[] = [];
  const conversationIds: string[] = [];

  // Synthetic signal ids: chat_session_scopes.scope_id is plain text with no
  // FK, and the seam never reads the intent row itself.
  const signalId = `intent-${run}-a`;
  const otherSignalId = `intent-${run}-b`;
  const silentSignalId = `intent-${run}-quiet`;

  const origFlag = process.env.NEGOTIATOR_CLIENT_DM_INJECT;

  /** Seeds a negotiator DM through the real writer, then its messages. */
  async function seedDm(
    userId: string,
    intentId: string,
    turns: Array<{ role: 'user' | 'agent'; text: string }>,
  ): Promise<string> {
    const conversationId = randomUUID();
    await conversations.createNegotiatorIntentChatSession({ id: conversationId, userId, intentId });
    conversationIds.push(conversationId);
    if (turns.length > 0) {
      // Explicit, strictly increasing timestamps: a batch insert would
      // otherwise share one now() and leave the tail order undefined.
      const base = Date.parse('2026-01-01T00:00:00.000Z');
      await db.insert(schema.messages).values(turns.map((turn, index) => ({
        conversationId,
        senderId: turn.role === 'agent' ? SYSTEM_AGENT_ID : userId,
        role: turn.role,
        parts: [{ type: 'text', text: turn.text }],
        createdAt: new Date(base + index * 1000),
      })));
    }
    return conversationId;
  }

  beforeAll(async () => {
    process.env.NEGOTIATOR_CLIENT_DM_INJECT = 'true';
    const users = await db.insert(schema.users).values(
      ['owner', 'stranger'].map((label) => ({
        email: `negodm-${label}-${run}@test.local`,
        name: `NegoDm ${label}`,
      })),
    ).returning({ id: schema.users.id });
    [ownerId, strangerId] = users.map((u) => u.id);
    userIds.push(...users.map((u) => u.id));

    // The signal under negotiation: 25 turns, so the 20-message cap bites.
    await seedDm(ownerId, signalId, [
      { role: 'user', text: `${run} opening context that must fall off the tail` },
      ...Array.from({ length: 22 }, (_, i) => ({
        role: (i % 2 === 0 ? 'agent' : 'user') as 'user' | 'agent',
        text: `${run} filler turn ${i}`,
      })),
      { role: 'user', text: `${run} no equity-only deals on this one` },
      { role: 'agent', text: `${run} understood, cash or nothing` },
    ]);

    // Same user, DIFFERENT signal — must never bleed into the first.
    await seedDm(ownerId, otherSignalId, [
      { role: 'user', text: `${run} for the OTHER signal I am flexible on equity` },
    ]);

    // Different user, SAME signal id — must never be reachable from the owner.
    await seedDm(strangerId, signalId, [
      { role: 'user', text: `${run} stranger private note` },
    ]);

    // A DM that exists but has nothing worth grounding on.
    await seedDm(ownerId, silentSignalId, [
      { role: 'user', text: '   ' },
      { role: 'agent', text: '' },
    ]);
  }, 30_000);

  afterAll(async () => {
    if (origFlag === undefined) delete process.env.NEGOTIATOR_CLIENT_DM_INJECT;
    else process.env.NEGOTIATOR_CLIENT_DM_INJECT = origFlag;
    await db.delete(schema.conversations).where(inArray(schema.conversations.id, conversationIds));
    await db.delete(schema.users).where(inArray(schema.users.id, userIds));
  }, 30_000);

  it('returns [] when NEGOTIATOR_CLIENT_DM_INJECT is off', async () => {
    process.env.NEGOTIATOR_CLIENT_DM_INJECT = 'false';
    try {
      expect(await retrieval.retrieveForNegotiation({ userId: ownerId, intentId: signalId })).toEqual([]);
    } finally {
      process.env.NEGOTIATOR_CLIENT_DM_INJECT = 'true';
    }
  });

  it('resolves a real excerpt for a user who has a negotiator DM on that signal', async () => {
    const excerpt = await retrieval.retrieveForNegotiation({ userId: ownerId, intentId: signalId });
    expect(excerpt.length).toBeGreaterThan(0);
    expect(excerpt.map((m) => m.content)).toContain(`${run} no equity-only deals on this one`);
    // Roles are projected to the client/agent vocabulary the prompt speaks.
    expect(new Set(excerpt.map((m) => m.role))).toEqual(new Set(['client', 'agent']));
  });

  it('returns [] for a user who has no negotiator DM on that signal', async () => {
    expect(await retrieval.retrieveForNegotiation({
      userId: ownerId,
      intentId: `intent-${run}-never-created`,
    })).toEqual([]);
  });

  it('keeps the recent tail, most recent last, within the cap', async () => {
    const excerpt = await retrieval.retrieveForNegotiation({ userId: ownerId, intentId: signalId });
    expect(excerpt.length).toBe(MAX_DM_MESSAGES);
    expect(excerpt[excerpt.length - 1].content).toBe(`${run} understood, cash or nothing`);
    expect(excerpt[excerpt.length - 1].role).toBe('agent');
    // 25 turns seeded, 20 kept: the oldest fell off, not the newest.
    expect(excerpt.map((m) => m.content)).not.toContain(`${run} opening context that must fall off the tail`);
  });

  it('does not reach another user\'s DM on the same signal', async () => {
    const excerpt = await retrieval.retrieveForNegotiation({ userId: ownerId, intentId: signalId });
    expect(excerpt.map((m) => m.content)).not.toContain(`${run} stranger private note`);
    // And the stranger sees only their own.
    const strangerExcerpt = await retrieval.retrieveForNegotiation({ userId: strangerId, intentId: signalId });
    expect(strangerExcerpt.map((m) => m.content)).toEqual([`${run} stranger private note`]);
  });

  it('does not reach the same user\'s DM on a different signal', async () => {
    const excerpt = await retrieval.retrieveForNegotiation({ userId: ownerId, intentId: signalId });
    expect(excerpt.map((m) => m.content)).not.toContain(`${run} for the OTHER signal I am flexible on equity`);
  });

  it('drops turns with no text and returns [] when none are left', async () => {
    expect(await retrieval.retrieveForNegotiation({ userId: ownerId, intentId: silentSignalId })).toEqual([]);
  });

  it('truncates one outsized message instead of letting it eat the budget', async () => {
    const longSignalId = `intent-${run}-long`;
    await seedDm(ownerId, longSignalId, [
      { role: 'user', text: 'x'.repeat(MAX_MESSAGE_CHARS + 500) },
      { role: 'agent', text: `${run} short reply survives intact` },
    ]);
    const excerpt = await retrieval.retrieveForNegotiation({ userId: ownerId, intentId: longSignalId });
    expect(excerpt.length).toBe(2);
    expect(excerpt[0].content.length).toBe(MAX_MESSAGE_CHARS + 1); // + the ellipsis
    expect(excerpt[0].content.endsWith('…')).toBe(true);
    expect(excerpt[1].content).toBe(`${run} short reply survives intact`);
  });

  it('returns [] on a blank userId or intentId rather than scanning', async () => {
    expect(await retrieval.retrieveForNegotiation({ userId: ownerId, intentId: '   ' })).toEqual([]);
    expect(await retrieval.retrieveForNegotiation({ userId: '', intentId: signalId })).toEqual([]);
  });
});
