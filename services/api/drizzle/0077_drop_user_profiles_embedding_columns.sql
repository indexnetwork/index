DROP INDEX "user_profiles_embedding_idx";--> statement-breakpoint
ALTER TABLE "user_profiles" DROP COLUMN "embedding";--> statement-breakpoint
ALTER TABLE "user_profiles" DROP COLUMN "implicit_intents";