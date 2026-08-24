-- Permanently retire the personal-network data model.
--
-- Runtime creation and use were removed before this migration. This migration
-- removes only networks explicitly linked through `personal_networks`; ordinary
-- communities are never selected. Intent and premise assignments are deleted,
-- leaving their owned records intact but unassigned when this was their only
-- network. The helper table makes the set stable across Drizzle statement
-- breakpoints and is dropped before the migration completes.

CREATE TABLE IF NOT EXISTS "_retired_personal_networks" (
  "network_id" text PRIMARY KEY
);--> statement-breakpoint

INSERT INTO "_retired_personal_networks" ("network_id")
SELECT "network_id"
FROM "personal_networks"
ON CONFLICT DO NOTHING;--> statement-breakpoint

DELETE FROM "intent_networks"
WHERE "network_id" IN (SELECT "network_id" FROM "_retired_personal_networks");--> statement-breakpoint

DELETE FROM "premise_networks"
WHERE "network_id" IN (SELECT "network_id" FROM "_retired_personal_networks");--> statement-breakpoint

DELETE FROM "network_members"
WHERE "network_id" IN (SELECT "network_id" FROM "_retired_personal_networks");--> statement-breakpoint

DELETE FROM "network_integrations"
WHERE "network_id" IN (SELECT "network_id" FROM "_retired_personal_networks");--> statement-breakpoint

DELETE FROM "personal_networks";--> statement-breakpoint

DELETE FROM "networks"
WHERE "id" IN (SELECT "network_id" FROM "_retired_personal_networks");--> statement-breakpoint

DROP TABLE IF EXISTS "_retired_personal_networks";--> statement-breakpoint

ALTER TABLE "networks" DROP COLUMN IF EXISTS "is_personal";
