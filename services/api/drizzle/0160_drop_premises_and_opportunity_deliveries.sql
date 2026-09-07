-- Remove the premises capability, the opportunity delivery ledger, and the
-- premise hash on the signal-intake pack. Nothing reads any of them: matching
-- is intent-only, and the delivery ledger existed solely for the deleted
-- confirm_opportunity_delivery tool.

DROP TABLE IF EXISTS "premise_networks";
--> statement-breakpoint
DROP TABLE IF EXISTS "premises";
--> statement-breakpoint
DROP TYPE IF EXISTS "public"."premise_status";
--> statement-breakpoint
DROP TABLE IF EXISTS "opportunity_deliveries";
--> statement-breakpoint
ALTER TABLE "signal_intake_packs" DROP COLUMN IF EXISTS "premise_hash";
--> statement-breakpoint
-- `manage:premises` is no longer a permission action; strip it from live grants
-- so nothing re-issues a key carrying a vocabulary the policy rejects.
UPDATE "agent_permissions"
SET "actions" = array_remove("actions", 'manage:premises')
WHERE 'manage:premises' = ANY("actions");
