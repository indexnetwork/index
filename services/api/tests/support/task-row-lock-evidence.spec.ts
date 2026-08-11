import { describe, expect, it } from 'bun:test';
import { PgDialect } from 'drizzle-orm/pg-core';

import { taskRowBlockerPredicate } from './task-row-lock-evidence';

const dialect = new PgDialect();
const normalize = (value: string) => value.replace(/\s+/g, ' ').trim();

describe('task-row lock evidence SQL', () => {
  it('binds every known blocker as an explicitly cast scalar', () => {
    const rendered = dialect.sqlToQuery(taskRowBlockerPredicate([247, 311]));

    expect(normalize(rendered.sql)).toBe(
      '($1::int = ANY(pg_blocking_pids(activity.pid)) OR $2::int = ANY(pg_blocking_pids(activity.pid)))',
    );
    expect(rendered.params).toEqual([247, 311]);
    expect(rendered.params.some(Array.isArray)).toBe(false);
  });

  it('refuses to render a predicate without blocking evidence', () => {
    expect(() => taskRowBlockerPredicate([])).toThrow('At least one blocker PID is required');
  });

  it('keeps unexpected input parameterized instead of adding it to SQL text', () => {
    const unexpected = '247) OR true --';
    const rendered = dialect.sqlToQuery(taskRowBlockerPredicate([unexpected as never]));

    expect(rendered.sql).not.toContain(unexpected);
    expect(rendered.sql).toContain('$1::int');
    expect(rendered.params).toEqual([unexpected]);
  });
});
