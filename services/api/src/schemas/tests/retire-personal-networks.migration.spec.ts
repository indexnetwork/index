import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';

const retirementMigration = readFileSync(new URL('../../../drizzle/0139_retire_personal_networks.sql', import.meta.url), 'utf8');
const finalizationMigration = readFileSync(
  new URL('../../../drizzle/0140_finalize_personal_network_retirement.sql', import.meta.url),
  'utf8',
);
const schema = readFileSync(new URL('../database.schema.ts', import.meta.url), 'utf8');

describe('personal-network retirement migrations', () => {
  test('preserves owned records while removing only mapped personal networks', () => {
    expect(retirementMigration).toContain('FROM "personal_networks"');
    expect(retirementMigration).toContain('DELETE FROM "intent_networks"');
    expect(retirementMigration).toContain('DELETE FROM "premise_networks"');
    expect(retirementMigration).toContain('DELETE FROM "network_members"');
    expect(retirementMigration).toContain('DELETE FROM "networks"');
    expect(retirementMigration).not.toContain('DELETE FROM "intents"');
    expect(retirementMigration).not.toContain('DELETE FROM "premises"');
  });

  test('drops the legacy physical model after cleanup', () => {
    expect(retirementMigration).toContain('DROP TABLE IF EXISTS "_retired_personal_networks"');
    expect(retirementMigration).toContain('ALTER TABLE "networks" DROP COLUMN IF EXISTS "is_personal"');
    expect(finalizationMigration).toContain('DROP TABLE IF EXISTS "personal_networks"');
    expect(schema).not.toContain("personalNetworks = pgTable");
    expect(schema).not.toContain("isPersonal: boolean('is_personal')");
  });
});
