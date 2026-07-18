import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const migrationPath = resolve(
  import.meta.dir,
  '../../../../drizzle/0095_add_outcome_feedback_events.sql',
);
const migrationSql = readFileSync(migrationPath, 'utf8');

describe('0095 outcome feedback append-only retention', () => {
  it('keeps privacy cascade for user deletion', () => {
    expect(migrationSql).toContain(
      'FOREIGN KEY ("recipient_user_id") REFERENCES "public"."users"("id") ON DELETE cascade',
    );
  });

  it('retains provenance across routine intent/opportunity source deletion', () => {
    // intent_id and opportunity_id remain not-null provenance identifiers, but
    // deliberately have no source FKs: deleting either source cannot erase the
    // append-only outcome history.
    expect(migrationSql).toContain('"intent_id" text NOT NULL');
    expect(migrationSql).toContain('"opportunity_id" text NOT NULL');
    expect(migrationSql).not.toContain('intent_id_intents_id_fk');
    expect(migrationSql).not.toContain('opportunity_id_opportunities_id_fk');
    expect(migrationSql).not.toContain('REFERENCES "public"."intents"');
    expect(migrationSql).not.toContain('REFERENCES "public"."opportunities"');
  });
});
