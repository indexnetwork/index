ALTER TABLE "users" DROP CONSTRAINT "users_agent_wallet_address_unique";--> statement-breakpoint
ALTER TABLE "users" DROP COLUMN "agent_wallet_address";--> statement-breakpoint
ALTER TABLE "users" DROP COLUMN "agent_wallet_encrypted_key";--> statement-breakpoint
ALTER TABLE "users" DROP COLUMN "agent_xmtp_inbox_id";