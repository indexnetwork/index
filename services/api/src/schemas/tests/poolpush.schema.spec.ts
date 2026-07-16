import { readFileSync } from 'node:fs';

import { describe, expect, test } from 'bun:test';
import type { SQL } from 'drizzle-orm';
import { getTableConfig, PgDialect } from 'drizzle-orm/pg-core';

import { questions } from '../database.schema';

const INDEX_NAME = 'questions_pool_push_recipient_intent_cycle_uniq';
const EXPECTED_EXPRESSIONS = [
  '("detection"->\'push\'->>\'recipientId\')',
  '("detection"->\'push\'->>\'intentId\')',
  '("detection"->\'push\'->>\'cycleKey\')',
];
const EXPECTED_WHERE = '"questions"."detection"->>\'mode\' = \'pool_discovery\' AND "questions"."detection"->\'push\'->>\'claimedAt\' IS NOT NULL';

type Snapshot = {
  tables: {
    'public.questions': {
      indexes: Record<string, {
        columns: Array<{ expression: string }>;
        where: string;
      }>;
    };
  };
};

describe('pool push unique intent-cycle invariant', () => {
  test('Drizzle, migration, and snapshot key the claimed push ledger identically', () => {
    const index = getTableConfig(questions).indexes.find((candidate) => candidate.config.name === INDEX_NAME);
    expect(index).toBeDefined();

    const dialect = new PgDialect();
    const schemaExpressions = index!.config.columns.map((column) => (
      dialect.sqlToQuery(column as SQL).sql.replaceAll('"questions".', '')
    ));
    const schemaWhere = dialect.sqlToQuery(index!.config.where as SQL).sql;
    expect(schemaExpressions).toEqual(EXPECTED_EXPRESSIONS);
    expect(schemaWhere).toBe(EXPECTED_WHERE);

    const migration = readFileSync(new URL('../../../drizzle/0094_add_pool_question_push.sql', import.meta.url), 'utf8');
    expect(migration).toContain(
      `CREATE UNIQUE INDEX "${INDEX_NAME}" ON "questions" USING btree (${EXPECTED_EXPRESSIONS.join(',')}) WHERE ${EXPECTED_WHERE};`,
    );
    expect(migration).not.toContain("->>'triggeredBy'");

    const snapshot = JSON.parse(
      readFileSync(new URL('../../../drizzle/meta/0094_snapshot.json', import.meta.url), 'utf8'),
    ) as Snapshot;
    const snapshotIndex = snapshot.tables['public.questions'].indexes[INDEX_NAME];
    expect(snapshotIndex.columns.map((column) => column.expression)).toEqual(EXPECTED_EXPRESSIONS);
    expect(snapshotIndex.where).toBe(EXPECTED_WHERE);
  });
});
