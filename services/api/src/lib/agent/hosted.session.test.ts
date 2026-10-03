import { expect, test } from 'bun:test';

import type { Intent, NegotiateRun } from '@indexnetwork/agent';

import { describeFailure } from './failure-line';
import { HostedSession, WAKE_RETRIES, WAKE_RETRY_MS, type HostedSessionIO, type NegotiationSeat } from './hosted.session';

const intent: Intent = { id: 'intent-1', statement: 'Meet collaborators' };

function flush(): Promise<void> {
  return new Promise((resolve) => { setTimeout(resolve, 0); });
}

function session(overrides: Partial<HostedSessionIO> = {}): { session: HostedSession; lines: string[] } {
  const lines: string[] = [];
  const io: HostedSessionIO = {
    running: () => true,
    holdsSeat: async () => true,
    activeIntent: async () => intent,
    runWake: async () => undefined,
    closeInitiation: async () => 'idle',
    runNegotiate: async () => ({ held: 'standing' }),
    getNegotiation: async (): Promise<NegotiationSeat> => ({ settledAt: null, awaitingUserId: 'user-1' }),
    schedule: () => undefined,
    onError: (line) => { lines.push(line); },
    verbose: () => undefined,
    ...overrides,
  };
  return { session: new HostedSession(io), lines };
}

test('describeFailure keeps the cause on the log line', () => {
  expect(describeFailure('Morning pass failed', new Error('model down'))).toBe('Morning pass failed: model down');
  expect(describeFailure('Hosted run failed', 'plain')).toBe('Hosted run failed: plain');
  expect(describeFailure('Negotiation summary failed', new Error('no signature'))).toBe('Negotiation summary failed: no signature');
});

test('a failed wake with a coalesced follow-up retries on a delay and stops after 3', async () => {
  const timers: Array<{ fn: () => void; ms: number }> = [];
  let wakes = 0;
  const built = session({
    runWake: async () => {
      wakes += 1;
      if (wakes === 1) void built.session.wake('user-1', 'intent-1');
      throw new Error('wake down');
    },
    schedule: (fn, ms) => { timers.push({ fn, ms }); },
  });

  built.session.run(built.session.wake('user-1', 'intent-1'));
  await flush();

  expect(wakes).toBe(1);
  expect(timers.map((timer) => timer.ms)).toEqual([WAKE_RETRY_MS]);
  expect(built.lines).toEqual(['Hosted run failed: wake down']);

  for (let guard = 0; guard < WAKE_RETRIES + 2 && timers.length; guard += 1) {
    const due = timers.splice(0, timers.length);
    for (const timer of due) timer.fn();
    await flush();
  }

  expect(wakes).toBe(1 + WAKE_RETRIES);
  expect(timers).toHaveLength(0);
  expect(built.lines).toHaveLength(1 + WAKE_RETRIES);
  expect(built.lines.every((line) => line === 'Hosted run failed: wake down')).toBe(true);
});

test('settle after an early takeTurn return does not summarize', async () => {
  let negotiations = 0;
  let summaries = 0;
  const built = session({
    getNegotiation: async () => ({ settledAt: null, awaitingUserId: 'someone-else' }),
    runNegotiate: async (): Promise<NegotiateRun> => {
      negotiations += 1;
      return { held: 'standing' };
    },
    closeInitiation: async () => {
      summaries += 1;
      return 'idle';
    },
  });

  await built.session.negotiate('user-1', 'intent-1', 'opp-1');
  expect(negotiations).toBe(0);
  expect(summaries).toBe(0);
  expect(built.lines).toHaveLength(0);
});

test('a thrown summary is not immediately run again', async () => {
  let summaries = 0;
  const built = session({
    closeInitiation: async () => {
      summaries += 1;
      if (summaries === 1) {
        void built.session.settle('user-1', 'intent-1');
        throw new Error('summary down');
      }
      return 'idle';
    },
  });

  await built.session.settle('user-1', 'intent-1');
  await flush();
  expect(summaries).toBe(1);
  expect(built.lines).toEqual(['Negotiation summary failed: summary down']);
});

test('a summary that finishes still runs one coalesced follow-up', async () => {
  let summaries = 0;
  let release: (status: 'pending') => void = () => undefined;
  const built = session({
    closeInitiation: () => {
      summaries += 1;
      if (summaries === 1) return new Promise((resolve) => { release = resolve; });
      return Promise.resolve('pending');
    },
  });

  const first = built.session.settle('user-1', 'intent-1');
  await flush();
  const second = built.session.settle('user-1', 'intent-1');
  release('pending');
  await Promise.all([first, second]);
  await flush();
  expect(summaries).toBe(2);
  expect(built.lines).toHaveLength(0);
});
