/**
 * Tests for the scope-aware branch in IntentGraph's queryNode.
 *
 * When state.indexScope is set and neither state.queryUserId nor state.networkId
 * is provided, the graph must return the caller's own intents across all reachable
 * indexes via getActiveIntentsAcrossIndexes — NOT getNetworkIntentsForMember.
 */
import { describe, expect, test } from 'bun:test';

import { IntentGraphFactory } from '../intent.graph.js';
import type {
  IntentGraphDatabase,
  ActiveIntent,
  CreatedIntent,
  ArchiveResult,
} from '../../shared/interfaces/database.interface.js';

const PERSONAL = 'personal-idx';
const EDGE_CITY = 'edge-city-idx';
const USER = 'user-yanki';
const OTHER = 'user-seref';

interface CallEntry {
  method: string;
  args: unknown[];
}

const makeDb = (): IntentGraphDatabase & { callLog: CallEntry[] } => {
  const callLog: CallEntry[] = [];

  return {
    callLog,

    async getActiveIntents(_userId: string): Promise<ActiveIntent[]> {
      return [];
    },

    async getActiveIntentsAcrossIndexes(userId: string, indexIds: string[]): Promise<ActiveIntent[]> {
      callLog.push({ method: 'getActiveIntentsAcrossIndexes', args: [userId, indexIds] });
      // Caller-owned intents — one in personal, one in edge-city
      return [
        {
          id: 'self-1',
          payload: 'My intent in personal',
          summary: 'p',
          createdAt: new Date('2026-01-01'),
        },
        {
          id: 'self-2',
          payload: 'My intent in edge-city',
          summary: 'e',
          createdAt: new Date('2026-01-02'),
        },
      ];
    },

    async getNetworkIntentsForMember(
      _indexId: string,
      _requestingUserId: string,
      _options?: { limit?: number; offset?: number },
    ) {
      callLog.push({ method: 'getNetworkIntentsForMember', args: [_indexId, _requestingUserId] });
      // Should NOT be called in the scoped read path under the new behavior
      return [
        {
          id: 'other-1',
          payload: 'Seref intent',
          summary: 's',
          createdAt: new Date(),
          userId: OTHER,
          userName: 'Seref',
        },
      ];
    },

    async getIntentsInIndexForMember(_userId: string, _indexNameOrId: string): Promise<ActiveIntent[]> {
      return [];
    },

    async isNetworkMember(_indexId: string, _userId: string): Promise<boolean> {
      return true;
    },

    async getUser(_userId: string) {
      return { id: _userId, name: 'Test User', email: 'test@example.com' };
    },

    async createIntent(data: {
      userId: string;
      payload: string;
      confidence: number;
      inferenceType: 'explicit' | 'implicit';
      sourceType?: string;
    }): Promise<CreatedIntent> {
      return {
        id: 'intent-1',
        userId: data.userId,
        payload: data.payload,
        summary: null,
        isIncognito: false,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
    },

    async updateIntent(_intentId: string, _data: { payload?: string }): Promise<CreatedIntent | null> {
      return null;
    },

    async archiveIntent(_intentId: string): Promise<ArchiveResult> {
      return { success: false, error: 'Not found' };
    },

    async getProfile(_userId: string) {
      return {
        identity: { name: 'Test User', bio: '', location: '' },
        narrative: { context: '' },
        attributes: { skills: [], interests: [] },
      } as never;
    },

    async assignIntentToNetwork(_intentId: string, _indexId: string): Promise<void> {
      // no-op
    },

    async getPersonalIndexesForContact(_userId: string): Promise<{ networkId: string }[]> {
      return [];
    },
  };
};

describe('IntentGraph read mode — indexScope-aware', () => {
  test('with indexScope and no queryUserId, returns caller-owned intents across scope', async () => {
    const db = makeDb();
    const factory = new IntentGraphFactory(db);
    const graph = factory.createGraph();

    const result = await graph.invoke({
      userId: USER,
      operationMode: 'read' as const,
      indexScope: [PERSONAL, EDGE_CITY],
      // intentionally no queryUserId, no networkId
    });

    expect(db.callLog.some((c) => c.method === 'getActiveIntentsAcrossIndexes')).toBe(true);
    expect(db.callLog.some((c) => c.method === 'getNetworkIntentsForMember')).toBe(false);
    expect(result.readResult?.count).toBe(2);
    expect(
      result.readResult?.intents.map((i: { id: string }) => i.id).sort(),
    ).toEqual(['self-1', 'self-2']);
  });

  test('with indexScope AND networkId, does NOT use the indexScope branch (falls through to effectiveIndexId)', async () => {
    const db = makeDb();
    const factory = new IntentGraphFactory(db);
    const graph = factory.createGraph();

    const result = await graph.invoke({
      userId: USER,
      operationMode: 'read' as const,
      networkId: EDGE_CITY,
      indexScope: [PERSONAL, EDGE_CITY],
    });

    // Should use getNetworkIntentsForMember (effectiveIndexId branch), not the new scope branch
    expect(db.callLog.some((c) => c.method === 'getNetworkIntentsForMember')).toBe(true);
    expect(db.callLog.some((c) => c.method === 'getActiveIntentsAcrossIndexes')).toBe(false);
    expect(result.readResult).toBeDefined();
  });

  test('with indexScope AND queryUserId, does NOT use the indexScope branch', async () => {
    const db = makeDb();
    const factory = new IntentGraphFactory(db);
    const graph = factory.createGraph();

    const result = await graph.invoke({
      userId: USER,
      operationMode: 'read' as const,
      queryUserId: OTHER,
      indexScope: [PERSONAL, EDGE_CITY],
    });

    // queryUserId is set — the guard !state.queryUserId fails, falls through to global path
    expect(db.callLog.some((c) => c.method === 'getActiveIntentsAcrossIndexes')).toBe(false);
    expect(result.readResult).toBeDefined();
  });
});
