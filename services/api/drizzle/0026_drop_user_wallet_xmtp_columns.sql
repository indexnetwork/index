DROP INDEX IF EXISTS "users_wallet_unique";--> statement-breakpoint
ALTER TABLE "users" DROP CONSTRAINT IF EXISTS "users_wallet_address_unique";--> statement-breakpoint
ALTER TABLE "users" DROP COLUMN IF EXISTS "wallet_address";--> statement-breakpoint
ALTER TABLE "users" DROP COLUMN IF EXISTS "wallet_encrypted_key";--> statement-breakpoint
ALTER TABLE "users" DROP COLUMN IF EXISTS "xmtp_inbox_id";
