import { describe, expect, it } from 'bun:test';

import { morningBriefTemplate } from '../email/templates/morning-brief.template';

import { MockLanguageModelV4 } from 'ai/test';

import { clipOpening, fallbackOpening, morningChatText, writeOpening, type Morning } from './morning';

// The template signs its accept, pass and unsubscribe links.
process.env.BETTER_AUTH_SECRET ??= 'morning-test-secret';

const person = { opportunityId: 'o1', userId: 'u2', name: 'Maya Chen', context: 'builds design tools', fresh: true };
const group = { id: 'g1', question: 'Are you open to remote?', url: 'https://index.network/q/q1' };

const base = {
  viewerId: 'u1', name: 'Seref Yarar', talked: 3, opening: 'Two of your intents found people overnight.',
  waiting: [], connected: [], questions: [], appUrl: 'https://index.network',
};

describe('clipOpening', () => {
  it('keeps at most two sentences', () => {
    expect(clipOpening('First one. Second one! Third one?')).toBe('First one. Second one!');
  });
  it('turns nothing into null', () => {
    expect(clipOpening('   ')).toBeNull();
    expect(clipOpening('')).toBeNull();
  });
});

describe('fallbackOpening', () => {
  it('says how many people your agents talked with', () => {
    expect(fallbackOpening(2)).toContain('2 people');
    expect(fallbackOpening(1)).toContain('1 person');
  });
  it('still opens on a quiet night', () => {
    expect(fallbackOpening(0)).toBeTruthy();
  });
});

describe('morningChatText', () => {
  it('is the opening, the people, and each question as a link', () => {
    const morning: Morning = { name: 'Seref Yarar', opening: base.opening, waiting: [person], groups: [group] };
    const text = morningChatText(morning);
    expect(text.startsWith(`Good morning, Seref. ${base.opening}`)).toBe(true);
    expect(text).toContain('Maya Chen');
    expect(text).toContain('(https://index.network/q/q1)');
  });
});

describe('morningBriefTemplate', () => {
  it('sends for a question alone, linking it to Home', () => {
    const email = morningBriefTemplate({ ...base, questions: [{ text: group.question, url: group.url }] });
    expect(email?.html).toContain('https://index.network/q/q1');
    expect(email?.html).toContain(base.opening);
    expect(email?.text).toContain('Answer: https://index.network/q/q1');
  });
  it('sends nothing with no new person and no question', () => {
    expect(morningBriefTemplate({ ...base, waiting: [{ ...person, fresh: false }] })).toBeNull();
  });
});

describe('writeOpening', () => {
  it('#7 gives up on a model that never answers, so the plain opening is used', async () => {
    const hung = new MockLanguageModelV4({
      doGenerate: ({ abortSignal }) => new Promise((_resolve, reject) => {
        abortSignal?.addEventListener('abort', () => reject(abortSignal.reason));
      }),
    });
    const started = Date.now();
    const input = { name: 'Seref', reports: [], talked: 0, waitingNames: [], groupCount: 1 };
    await expect(writeOpening(input, hung, 50)).rejects.toBeDefined();
    expect(Date.now() - started).toBeLessThan(2000);
  });
});
