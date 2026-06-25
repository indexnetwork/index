/** Unit tests for QuestionerQueue payload-to-persistence mapping. */
process.env.DATABASE_URL = process.env.DATABASE_URL ?? 'postgresql://unused:unused@localhost:5432/unused';

import { afterEach, describe, expect, it } from 'bun:test';

import { QuestionerQueue } from '../questioner.queue';
import type { PersistableQuestion, QuestionGenerationResult } from '@indexnetwork/protocol';

describe('QuestionerQueue', () => {
  const queues: QuestionerQueue[] = [];

  afterEach(async () => {
    await Promise.all(queues.splice(0).map((queue) => queue.close().catch(() => undefined)));
  });

  it('persists scoped question actors with the network scope id', async () => {
    let captured: PersistableQuestion[] = [];
    const result: QuestionGenerationResult = {
      questions: [
        {
          title: 'Focus',
          prompt: 'Which collaboration focus matters most?',
          options: [
            { label: 'Build', description: 'Build together' },
            { label: 'Learn', description: 'Exchange knowledge' },
          ],
          multiSelect: false,
        },
      ],
      strategies: ['surface_missing_detail'],
    };
    const queue = new QuestionerQueue({
      adapter: {
        persist: async (batch) => {
          captured = batch;
          return ['question-1'];
        },
      },
      agent: { invoke: async () => result },
    });
    queues.push(queue);

    await queue.processJob('generate_questions', {
      mode: 'discovery',
      userId: 'user-1',
      sourceType: 'discovery',
      sourceId: 'session-1',
      context: {} as never,
      scopeType: 'network',
      scopeId: 'network-1',
      conversationId: 'session-1',
    });

    expect(captured).toHaveLength(1);
    expect(captured[0].actors).toEqual([
      { userId: 'user-1', role: 'subject', networkId: 'network-1' },
    ]);
  });

  it('omits actor networkId for unscoped question jobs', async () => {
    let captured: PersistableQuestion[] = [];
    const queue = new QuestionerQueue({
      adapter: {
        persist: async (batch) => {
          captured = batch;
          return ['question-1'];
        },
      },
      agent: {
        invoke: async () => ({
          questions: [
            {
              title: 'Focus',
              prompt: 'Which collaboration focus matters most?',
              options: [
                { label: 'Build', description: 'Build together' },
                { label: 'Learn', description: 'Exchange knowledge' },
              ],
              multiSelect: false,
            },
          ],
          strategies: ['surface_missing_detail'],
        }),
      },
    });
    queues.push(queue);

    await queue.processJob('generate_questions', {
      mode: 'discovery',
      userId: 'user-1',
      sourceType: 'discovery',
      sourceId: 'session-1',
      context: {} as never,
    });

    expect(captured[0].actors).toEqual([{ userId: 'user-1', role: 'subject' }]);
  });
});
