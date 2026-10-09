import { expect, test } from 'bun:test';

import { createMorningBrief, type MorningLock, type MorningOwner } from './morning';

const now = new Date('2026-10-03T10:00:00Z');

function owners(count: number): MorningOwner[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `user-${index}`,
    timezone: 'UTC',
    lastMorningBriefAt: null,
  }));
}

function heldWork(): { work: (owner: MorningOwner) => Promise<void>; started: () => number; release: () => void } {
  let started = 0;
  let release: () => void = () => undefined;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  return {
    started: () => started,
    release: () => { release(); },
    work: async () => {
      started += 1;
      await gate;
    },
  };
}

test('an overlapping tick does not start work for more than cap owners', async () => {
  const gate = heldWork();
  const brief = createMorningBrief({
    cap: 4,
    listHostedOwners: async () => owners(8),
    claim: async () => ({ previous: null }),
    work: gate.work,
  });

  await Promise.all([brief.tick(now), brief.tick(now)]);
  expect(gate.started()).toBe(4);
  gate.release();
  await new Promise((resolve) => { setTimeout(resolve, 0); });
});

test('the previous morning reaches the work as its claim', async () => {
  const previous = new Date('2026-10-02T08:30:00Z');
  const seen: (Date | null)[] = [];
  const brief = createMorningBrief({
    listHostedOwners: async () => owners(1),
    claim: async () => ({ previous }),
    work: async (_owner, claim) => { seen.push(claim.previous); },
  });

  await brief.tick(now);
  await new Promise((resolve) => { setTimeout(resolve, 0); });
  expect(seen).toEqual([previous]);
});

test('two replicas sharing a lock do not each start cap owners', async () => {
  let held = false;
  const lock: MorningLock = async () => {
    if (held) return null;
    held = true;
    return async () => { held = false; };
  };
  const gate = heldWork();
  const deps = {
    cap: 4,
    lock,
    listHostedOwners: async () => owners(8),
    claim: async () => ({ previous: null }),
    work: gate.work,
  };
  const left = createMorningBrief(deps);
  const right = createMorningBrief(deps);

  await Promise.all([left.tick(now), right.tick(now)]);
  expect(gate.started()).toBe(4);
  expect(held).toBe(true);
  gate.release();
  await new Promise((resolve) => { setTimeout(resolve, 0); });
  expect(held).toBe(false);
});
