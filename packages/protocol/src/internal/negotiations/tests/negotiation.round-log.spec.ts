import { describe, expect, it } from 'bun:test';

import { foldNegotiationRoundLog, type NegotiationRoundLogEvent } from '../negotiation.round-log.js';

const BATCH = 'batch-1';

function opened(taskId: string): NegotiationRoundLogEvent {
  return { kind: 'opened', taskId, batchId: BATCH };
}
function stopped(taskId: string, via: 'paused' | 'completed' = 'paused'): NegotiationRoundLogEvent {
  return { kind: 'stopped', taskId, batchId: BATCH, via, reason: via === 'paused' ? 'needs_principal' : undefined };
}
function resumed(taskId: string): NegotiationRoundLogEvent {
  return { kind: 'resumed', taskId, batchId: BATCH };
}
function openingComplete(): NegotiationRoundLogEvent {
  return { kind: 'opening_complete', batchId: BATCH };
}

describe('foldNegotiationRoundLog', () => {
  it('is not settled when no tasks have stopped', () => {
    const result = foldNegotiationRoundLog([opened('t1'), opened('t2')]);

    expect(result.settled).toBe(false);
    expect(result.dedupeKey).toBeUndefined();
  });

  it('is not settled when only some tasks have stopped', () => {
    const result = foldNegotiationRoundLog([opened('t1'), opened('t2'), stopped('t1', 'completed'), openingComplete()]);

    expect(result.settled).toBe(false);
  });

  it('is not settled before opening_complete lands, even if every opened task has already stopped', () => {
    const result = foldNegotiationRoundLog([opened('t1'), opened('t2'), stopped('t1', 'paused'), stopped('t2', 'completed')]);

    expect(result.settled).toBe(false);
  });

  it('settles once opening_complete lands after every opened task has stopped', () => {
    const result = foldNegotiationRoundLog([
      opened('t1'), opened('t2'), stopped('t1', 'paused'), stopped('t2', 'completed'), openingComplete(),
    ]);

    expect(result.settled).toBe(true);
  });

  it('settles a zero-task batch immediately once opening_complete lands', () => {
    const result = foldNegotiationRoundLog([openingComplete()]);

    expect(result.settled).toBe(true);
    expect(result.dedupeKey).toBe('empty');
  });

  it('is settled with a dedupe key once every task has stopped, mixing paused and completed', () => {
    const events = [opened('t1'), opened('t2'), stopped('t1', 'paused'), stopped('t2', 'completed'), openingComplete()];

    const result = foldNegotiationRoundLog(events);

    expect(result.settled).toBe(true);
    expect(result.dedupeKey).toBe('t1.2_t2.3');
  });

  it('produces a different dedupe key on the second settle after a task resumes and stops again', () => {
    const firstSettleEvents: NegotiationRoundLogEvent[] = [
      opened('t1'), opened('t2'), stopped('t1', 'paused'), stopped('t2', 'completed'), openingComplete(),
    ];
    const firstResult = foldNegotiationRoundLog(firstSettleEvents);

    const afterResume = [...firstSettleEvents, resumed('t1')];
    expect(foldNegotiationRoundLog(afterResume).settled).toBe(false);

    const secondSettleEvents = [...afterResume, stopped('t1', 'completed')];
    const secondResult = foldNegotiationRoundLog(secondSettleEvents);

    expect(firstResult.settled).toBe(true);
    expect(secondResult.settled).toBe(true);
    expect(secondResult.dedupeKey).not.toBe(firstResult.dedupeKey);
    expect(firstResult.dedupeKey).toBe('t1.2_t2.3');
    expect(secondResult.dedupeKey).toBe('t1.6_t2.3');
  });

  it('is idempotent: redelivering the same final log state yields the same dedupe key', () => {
    const events = [opened('t1'), opened('t2'), stopped('t1', 'paused'), stopped('t2', 'completed'), openingComplete()];

    const first = foldNegotiationRoundLog(events);
    const second = foldNegotiationRoundLog([...events]);

    expect(first.settled).toBe(true);
    expect(second.settled).toBe(true);
    expect(second.dedupeKey).toBe(first.dedupeKey);
  });
});
