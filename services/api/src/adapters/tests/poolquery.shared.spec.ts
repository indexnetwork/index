import { describe, expect, it } from 'bun:test';

import { PgDialect } from 'drizzle-orm/pg-core';

import { exactEvidencePoolWhere, exactLivePoolWhere, POOL_LIVE_STATUSES, POOL_TERMINAL_STATUSES } from '../poolquery.shared';

const dialect = new PgDialect();

describe('poolquery predicates — Lens A vs Lens C (IND-465)', () => {
  it('keeps the shared Lens A live-pool predicate on live statuses only', () => {
    const { sql, params } = dialect.sqlToQuery(exactLivePoolWhere('user-1', 'intent-1'));
    expect(sql).toContain("'triggeredBy'");
    expect(params).toContain('intent-1');
    for (const status of POOL_LIVE_STATUSES) expect(params).toContain(status);
    for (const status of POOL_TERMINAL_STATUSES) expect(params).not.toContain(status);
  });

  it('widens ONLY the Lens C evidence-pool predicate to terminal statuses', () => {
    const { sql, params } = dialect.sqlToQuery(exactEvidencePoolWhere('user-1', 'intent-1'));
    expect(sql).toContain("'triggeredBy'");
    expect(params).toContain('intent-1');
    for (const status of [...POOL_LIVE_STATUSES, ...POOL_TERMINAL_STATUSES]) {
      expect(params).toContain(status);
    }
  });

  it('shares one visibility guard: the predicates differ only in the status list', () => {
    const live = dialect.sqlToQuery(exactLivePoolWhere('user-1', 'intent-1'));
    const evidence = dialect.sqlToQuery(exactEvidencePoolWhere('user-1', 'intent-1'));
    const normalize = (query: { sql: string }) => query.sql.replace(/\$\d+/g, '$?');
    expect(normalize(evidence).replace(', $?'.repeat(POOL_TERMINAL_STATUSES.length), ''))
      .toBe(normalize(live));
    expect(evidence.params.slice(0, live.params.length)).toEqual(live.params);
    expect(evidence.params.slice(live.params.length)).toEqual([...POOL_TERMINAL_STATUSES]);
  });
});
