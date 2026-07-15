/**
 * Client-strip invariant: server-only pool internals (IND-418) and question
 * generation/QUD metadata (IND-425) never leave QuestionService reads.
 */
import { describe, it, expect } from 'bun:test';

import { QuestionService, stripInternalDetection } from '../question.service';
import type { AdapterPersistedQuestion, QuestionerAdapter } from '../../adapters/questioner.adapter';

function poolQuestion(): AdapterPersistedQuestion {
  return {
    id: 'q-1',
    detection: {
      mode: 'pool_discovery',
      sourceType: 'intent',
      sourceId: 'intent-1',
      triggeredBy: 'intent-1',
      timestamp: 'now',
      strategy: 'surface_missing_detail',
      underspecificationType: 'missing_constraint',
      pool: {
        poolSize: 21,
        minedAt: 'now',
        discriminator: {
          label: 'axis',
          questionSeed: 'seed?',
          sides: ['A', 'B'],
          sideCounts: { A: 5, B: 4 },
          voi: 0.5,
          evidenceRate: 0.9,
          assignments: [{ opportunityId: 'opp-1', side: 'A' }],
        },
        alternates: [],
      },
    },
    actors: [{ userId: 'user-1', role: 'subject' }],
    payload: {
      title: 'Matches',
      prompt: 'Which?',
      options: [{ label: 'A', description: 'd' }, { label: 'B', description: 'd' }],
      multiSelect: false,
      evidence: 'based on 21 people matching this intent',
    },
    status: 'pending',
    answer: null,
    expiresAt: null,
    createdAt: 'now',
    conversationId: null,
  };
}

describe('stripInternalDetection', () => {
  it('removes detection.pool and keeps everything else', () => {
    const stripped = stripInternalDetection(poolQuestion());
    expect(stripped.detection.pool).toBeUndefined();
    expect(stripped.detection.strategy).toBeUndefined();
    expect(stripped.detection.underspecificationType).toBeUndefined();
    expect(stripped.detection.mode).toBe('pool_discovery');
    expect(stripped.detection.triggeredBy).toBe('intent-1');
    expect(stripped.payload.evidence).toBe('based on 21 people matching this intent');
    expect(JSON.stringify(stripped)).not.toContain('assignments');
    expect(JSON.stringify(stripped)).not.toContain('opp-1');
  });

  it('strips generation metadata even without a pool snapshot', () => {
    const q = poolQuestion();
    delete (q.detection as { pool?: unknown }).pool;
    const stripped = stripInternalDetection(q);
    expect(stripped).not.toBe(q);
    expect(stripped.detection.strategy).toBeUndefined();
    expect(stripped.detection.underspecificationType).toBeUndefined();
  });

  it('leaves questions without internal detection metadata untouched', () => {
    const q = poolQuestion();
    delete (q.detection as { pool?: unknown }).pool;
    delete (q.detection as { strategy?: unknown }).strategy;
    delete (q.detection as { underspecificationType?: unknown }).underspecificationType;
    expect(stripInternalDetection(q)).toBe(q);
  });
});

describe('QuestionService.findPending', () => {
  it('strips detection.pool from every returned row', async () => {
    const adapter = {
      findPending: async () => [poolQuestion(), poolQuestion()],
    } as unknown as QuestionerAdapter;
    const service = new QuestionService(adapter);
    const rows = await service.findPending('user-1');
    expect(rows).toHaveLength(2);
    for (const row of rows) {
      expect(row.detection.pool).toBeUndefined();
      expect(row.detection.strategy).toBeUndefined();
      expect(row.detection.underspecificationType).toBeUndefined();
    }
    expect(JSON.stringify(rows)).not.toContain('assignments');
  });
});
