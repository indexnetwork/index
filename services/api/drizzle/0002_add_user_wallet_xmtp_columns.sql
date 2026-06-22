ALTER TABLE "users" ADD COLUMN "wallet_address" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "wallet_encrypted_key" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "xmtp_inbox_id" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "agent_wallet_address" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "agent_wallet_encrypted_key" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "agent_xmtp_inbox_id" text;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_wallet_address_unique" UNIQUE("wallet_address");--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_agent_wallet_address_unique" UNIQUE("agent_wallet_address");