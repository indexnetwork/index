-- Remove headless master-key signup and the Composio integration links. The
-- experiment service that hashed a per-network key is gone, and with Gmail and
-- Slack deleted no toolkit remains to connect, so the join table has no writer.

ALTER TABLE "networks" DROP COLUMN IF EXISTS "master_key_hash";
--> statement-breakpoint
DROP TABLE IF EXISTS "network_integrations";
