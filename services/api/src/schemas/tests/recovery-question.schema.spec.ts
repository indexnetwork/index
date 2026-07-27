import { readFileSync } from 'node:fs';

import { describe, expect, test } from 'bun:test';
import type { SQL } from 'drizzle-orm';
import { getTableConfig, PgDialect } from 'drizzle-orm/pg-core';

import { questions } from '../database.schema';

const INDEX_NAME = 'questions_recovery_recipient_intent_fingerprint_uniq';
const EXPECTED_EXPRESSIONS = [
  '("actors"->0->>\'userId\')',
  '("detection"->>\'sourceId\')',
  '("detection"->\'recovery\'->>\'intentFingerprint\')',
];
const EXPECTED_WHERE = '"questions"."detection"->>\'purpose\' = \'recovery\' AND "questions"."detection"->>\'mode\' = \'intent\' AND "questions"."detection"->>\'sourceType\' = \'intent\'';

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

describe('recovery question cadence unique invariant', () => {
  test('Drizzle, migration, and snapshot key recipient + intent + fingerprint across all lifecycle states', () => {
    const index = getTableConfig(questions).indexes.find((candidate) => candidate.config.name === INDEX_NAME);
    expect(index).toBeDefined();

    const dialect = new PgDialect();
    const schemaExpressions = index!.config.columns.map((column) => (
      dialect.sqlToQuery(column as SQL).sql.replaceAll('"questions".', '')
    ));
    const schemaWhere = dialect.sqlToQuery(index!.config.where as SQL).sql;
    expect(schemaExpressions).toEqual(EXPECTED_EXPRESSIONS);
    expect(schemaWhere).toBe(EXPECTED_WHERE);

    const migration = readFileSync(new URL('../../../drizzle/0105_add_recovery_question_uniqueness.sql', import.meta.url), 'utf8');
    expect(migration).toContain(
      `CREATE UNIQUE INDEX "${INDEX_NAME}" ON "questions" USING btree (${EXPECTED_EXPRESSIONS.join(',')}) WHERE ${EXPECTED_WHERE};`,
    );
    expect(migration).not.toContain('status');
    expect(migration).not.toContain('expires_at');

    const snapshot = JSON.parse(
      readFileSync(new URL('../../../drizzle/meta/0105_snapshot.json', import.meta.url), 'utf8'),
    ) as Snapshot;
    const snapshotIndex = snapshot.tables['public.questions'].indexes[INDEX_NAME];
    expect(snapshotIndex.columns.map((column) => column.expression)).toEqual(EXPECTED_EXPRESSIONS);
    expect(snapshotIndex.where).toBe(EXPECTED_WHERE);
  });
});
