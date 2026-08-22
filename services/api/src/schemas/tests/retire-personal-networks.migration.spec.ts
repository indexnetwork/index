import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';

const migration = readFileSync(new URL('../../../drizzle/0139_retire_personal_networks.sql', import.meta.url), 'utf8');
const schema = readFileSync(new URL('../database.schema.ts', import.meta.url), 'utf8');

describe('0139 retire personal networks', () => {
  test('preserves owned records while removing only mapped personal networks', () => {
    expect(migration).toContain('FROM "personal_networks"');
    expect(migration).toContain('DELETE FROM "intent_networks"');
    expect(migration).toContain('DELETE FROM "premise_networks"');
    expect(migration).toContain('DELETE FROM "network_members"');
    expect(migration).toContain('DELETE FROM "networks"');
    expect(migration).not.toContain('DELETE FROM "intents"');
    expect(migration).not.toContain('DELETE FROM "premises"');
  });

  test('drops the legacy physical model after cleanup', () => {
    expect(migration).toContain('DROP TABLE IF EXISTS "_retired_personal_networks"');
    expect(migration).toContain('ALTER TABLE "networks" DROP COLUMN IF EXISTS "is_personal"');
    expect(schema).not.toContain("personalNetworks = pgTable");
    expect(schema).not.toContain("isPersonal: boolean('is_personal')");
  });
});
