import { describe, expect, test } from 'bun:test';
import { PgDialect } from 'drizzle-orm/pg-core';

import { notificationSnapshotOpportunityWhere } from '../opportunity.database.adapter';

describe('notification snapshot opportunity query', () => {
  test('selects latent and pending rows by actor membership without legacy role visibility', () => {
    const rendered = new PgDialect().sqlToQuery(notificationSnapshotOpportunityWhere('viewer'));
    const query = rendered.sql.replace(/\s+/g, ' ').trim();

    expect(query).toContain('"opportunities"."actors"::jsonb @> $1::jsonb');
    expect(query).toContain('"opportunities"."status" in ($2, $3)');
    expect(rendered.params).toEqual([
      JSON.stringify([{ userId: 'viewer' }]),
      'latent',
      'pending',
    ]);
    expect(query).not.toContain('role');
  });
});
