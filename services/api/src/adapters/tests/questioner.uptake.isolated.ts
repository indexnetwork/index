process.env.DATABASE_URL = process.env.DATABASE_URL ?? 'postgresql://unused:unused@localhost:5432/unused';

import { describe, expect, it } from 'bun:test';

import { QuestionerAdapter } from '../questioner.adapter';

function sqlText(value: unknown): string {
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return value.map(sqlText).join(' ');
  if (typeof value !== 'object' || value === null) return '';
  const candidate = value as { value?: unknown; queryChunks?: unknown[] };
  return `${sqlText(candidate.value)} ${sqlText(candidate.queryChunks)}`;
}

function chain(rows: unknown[] = []) {
  const query = {
    from: () => query,
    where: () => query,
    orderBy: () => query,
    limit: async () => rows,
    then: (resolve: (value: unknown[]) => unknown) => Promise.resolve(rows).then(resolve),
  };
  return query;
}

describe('QuestionerAdapter uptake filters', () => {
  it('pushes purpose into the findPending SQL predicate', async () => {
    let whereClause: unknown;
    const query = chain();
    query.where = (condition: unknown) => { whereClause = condition; return query; };
    const adapter = new QuestionerAdapter({ select: () => query } as never);
    await adapter.findPending('user-1', {
      purpose: 'uptake', sourceType: 'opportunity', sourceId: 'opp-1',
    });
    expect(sqlText(whereClause)).toContain('purpose');
  });

  it('checks exact recipient/source/purpose across all statuses', async () => {
    let whereClause: unknown;
    const query = chain([{ id: 'q-1' }]);
    query.where = (condition: unknown) => { whereClause = condition; return query; };
    const adapter = new QuestionerAdapter({ select: () => query } as never);
    await expect(adapter.existsForRecipientSourcePurpose(
      'user-1', 'opportunity', 'opp-1', 'uptake',
    )).resolves.toBe(true);
    const serialized = sqlText(whereClause);
    expect(serialized).toContain('purpose');
    expect(serialized).not.toContain('status');
  });
});
