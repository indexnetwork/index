/**
 * The reply transport's contract (phase 2 of
 * docs/plans/2026-08-21-holistic-intent-agent.md): chunks published on a
 * turn's channel reach a subscriber established beforehand, in order;
 * malformed payloads are dropped rather than crashing the relay (the
 * job-result fallback owns completeness); and the sentence chunker
 * reassembles losslessly — the streamed text can never differ from the
 * checked, persisted reply it was cut from.
 *
 * Runs against the hermetic in-process bus (the same `useHermeticRedis()`
 * guard the queue factory applies), which is exactly what the controller and
 * worker use under test — so this is the relay the controller spec's
 * SSE-level test rides on, pinned one level down.
 */
import { describe, expect, it } from 'bun:test';

import { chunkReplyText, intentAgentReplyChannel, publishIntentAgentReplyChunk, subscribeIntentAgentReply } from '../intent-agent-reply.stream';
import type { IntentAgentReplyChunk } from '../intent-agent-reply.stream';

describe('intent-agent reply transport (hermetic bus)', () => {
  it('delivers published chunks to an established subscriber, in publish order', async () => {
    const received: IntentAgentReplyChunk[] = [];
    const unsubscribe = await subscribeIntentAgentReply('message-1', (chunk) => received.push(chunk));

    await publishIntentAgentReplyChunk('message-1', { seq: 1, content: 'First. ' });
    await publishIntentAgentReplyChunk('message-1', { seq: 2, content: 'Second.' });
    // A different turn's channel must not leak in.
    await publishIntentAgentReplyChunk('message-2', { seq: 1, content: 'Other turn.' });

    unsubscribe();
    // After cleanup nothing more arrives.
    await publishIntentAgentReplyChunk('message-1', { seq: 3, content: 'Late.' });

    expect(received).toEqual([
      { seq: 1, content: 'First. ' },
      { seq: 2, content: 'Second.' },
    ]);
  });

  it('drops payloads that are not chunks instead of crashing the relay', async () => {
    const received: IntentAgentReplyChunk[] = [];
    const unsubscribe = await subscribeIntentAgentReply('message-3', (chunk) => received.push(chunk));

    // A misshapen payload (no content) and a well-formed one: only the
    // well-formed chunk reaches the handler — the job-result fallback owns
    // completeness, so dropping is the honest move.
    await publishIntentAgentReplyChunk('message-3', { seq: 1 } as IntentAgentReplyChunk);
    await publishIntentAgentReplyChunk('message-3', { seq: 2, content: 'Real.' });

    unsubscribe();
    expect(received).toEqual([{ seq: 2, content: 'Real.' }]);
  });

  it('keys channels by message id', () => {
    expect(intentAgentReplyChannel('abc')).toBe('intent-agent:reply:abc');
  });
});

describe('chunkReplyText', () => {
  it('cuts on sentence boundaries and reassembles losslessly', () => {
    const text = 'Done — I declined that match. Nothing else needs you right now! Want my read on the other one?';
    const chunks = chunkReplyText(text);
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.join('')).toBe(text);
  });

  it('is lossless on text with no sentence punctuation, newlines, and separators', () => {
    for (const text of [
      'no punctuation at all',
      'line one\nline two\n',
      '\n\nSecond message after a separator.',
      'Trailing space. ',
      '…',
    ]) {
      expect(chunkReplyText(text).join('')).toBe(text);
    }
  });
});
