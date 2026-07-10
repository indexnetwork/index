-- IND-410: Per-user negotiator agent rows.
-- Semantics realign: 'personal' = the user's own negotiator (one per user),
-- 'external' = registered third-party poller runtime, 'system' = seeded builtins.
--
-- 1. Every existing 'personal' row is a registered poller -> re-type to 'external'.
--    (System rows are untouched.)
UPDATE "agents" SET "type" = 'external' WHERE "type" = 'personal';--> statement-breakpoint
-- 2. Backfill one 'personal' negotiator row per non-ghost user. Ghost users
--    (contact imports / chat inserts) never signed up and get no negotiator.
--    Name: "{firstName}'s Negotiator", fallback "Your Negotiator".
INSERT INTO "agents" ("id", "owner_id", "name", "description", "type", "status", "metadata", "handle_negotiations")
SELECT
  gen_random_uuid(),
  u."id",
  CASE
    WHEN COALESCE(NULLIF(TRIM(split_part(u."name", ' ', 1)), ''), '') <> ''
      THEN TRIM(split_part(u."name", ' ', 1)) || '''s Negotiator'
    ELSE 'Your Negotiator'
  END,
  'Negotiates on your behalf across the network.',
  'personal',
  'active',
  '{}'::jsonb,
  false
FROM "users" u
WHERE u."is_ghost" = false
  AND NOT EXISTS (
    SELECT 1 FROM "agents" a
    WHERE a."owner_id" = u."id" AND a."type" = 'personal' AND a."deleted_at" IS NULL
  );--> statement-breakpoint
-- 3. One active personal negotiator per owner — created here (after the re-type)
--    because pre-migration data may hold several 'personal' poller rows per owner.
CREATE UNIQUE INDEX "uniq_agents_personal_per_owner" ON "agents" USING btree ("owner_id") WHERE "agents"."type" = 'personal' AND "agents"."deleted_at" IS NULL;
