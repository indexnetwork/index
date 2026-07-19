import { config } from 'dotenv';
config({ path: '.env.test', override: true });

import { describe, expect, test } from 'bun:test';

import { IntentController } from '../intent.controller';
import type { AuthenticatedUser } from '../../guards/auth.guard';
import type { IntentService } from '../../services/intent.service';
import type { QuestionService } from '../../services/question.service';

const user: AuthenticatedUser = {
  id: 'user-1',
  email: 'user-1@example.com',
  name: 'User One',
};

function listRequest(): Request {
  return new Request('http://localhost/intents/list', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ page: 1, limit: 20 }),
  });
}

describe('IntentController pending-question counts', () => {
  test('attaches one bulk result and forwards the request network scope', async () => {
    let countCalls = 0;
    let capturedOptions: { networkId?: string; modes?: string[] } | undefined;
    const intents = {
      listIntents: async () => ({
        intents: [
          {
            id: 'intent-1',
            payload: 'First intent',
            summary: null,
            status: 'ACTIVE' as const,
            isIncognito: false,
            createdAt: new Date('2026-07-18T10:00:00.000Z'),
            updatedAt: new Date('2026-07-18T11:00:00.000Z'),
            archivedAt: null,
            sourceType: null,
            sourceId: null,
            networks: [],
          },
          {
            id: 'intent-2',
            payload: 'Second intent',
            summary: null,
            status: 'PAUSED' as const,
            isIncognito: false,
            createdAt: new Date('2026-07-17T10:00:00.000Z'),
            updatedAt: new Date('2026-07-17T11:00:00.000Z'),
            archivedAt: null,
            sourceType: null,
            sourceId: null,
            networks: [],
          },
        ],
        pagination: { current: 1, total: 1, count: 2, totalCount: 2 },
      }),
    } as unknown as Pick<IntentService, 'listIntents'>;
    const questions = {
      countPendingByIntent: async (
        userId: string,
        intentIds: string[],
        options?: { networkId?: string; modes?: string[] },
      ) => {
        countCalls += 1;
        expect(userId).toBe(user.id);
        expect(intentIds).toEqual(['intent-1', 'intent-2']);
        capturedOptions = options;
        return new Map([['intent-1', 3]]);
      },
    } as Pick<QuestionService, 'countPendingByIntent'>;
    const controller = new IntentController(
      intents,
      questions,
      async (_req, authenticatedUser) => ({
        user: authenticatedUser,
        networkScopeId: 'network-1',
      }),
    );

    const response = await controller.list(listRequest(), user);
    const body = await response.json() as {
      intents: Array<{ id: string; pendingQuestionCount: number }>;
    };

    expect(response.status).toBe(200);
    expect(countCalls).toBe(1);
    expect(capturedOptions).toEqual({
      networkId: 'network-1',
      modes: ['enrichment', 'intent', 'discovery'],
    });
    expect(body.intents).toEqual([
      expect.objectContaining({ id: 'intent-1', pendingQuestionCount: 3 }),
      expect.objectContaining({ id: 'intent-2', pendingQuestionCount: 0 }),
    ]);
  });
});
