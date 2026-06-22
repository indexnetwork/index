ALTER TABLE IF EXISTS "chat_message_metadata" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE IF EXISTS "chat_messages" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE IF EXISTS "chat_session_metadata" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE IF EXISTS "chat_sessions" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE IF EXISTS "hidden_conversations" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
DROP TABLE IF EXISTS "chat_message_metadata" CASCADE;--> statement-breakpoint
DROP TABLE IF EXISTS "chat_messages" CASCADE;--> statement-breakpoint
DROP TABLE IF EXISTS "chat_session_metadata" CASCADE;--> statement-breakpoint
DROP TABLE IF EXISTS "chat_sessions" CASCADE;--> statement-breakpoint
DROP TABLE IF EXISTS "hidden_conversations" CASCADE;--> statement-breakpoint
ALTER TABLE "users" DROP CONSTRAINT IF EXISTS "users_wallet_address_unique";--> statement-breakpoint
ALTER TABLE "users" DROP COLUMN IF EXISTS "wallet_address";--> statement-breakpoint
ALTER TABLE "users" DROP COLUMN IF EXISTS "wallet_encrypted_key";--> statement-breakpoint
ALTER TABLE "users" DROP COLUMN IF EXISTS "xmtp_inbox_id";--> statement-breakpoint
DROP TYPE IF EXISTS "public"."chat_message_role";