CREATE TYPE "public"."assignment_visibility" AS ENUM('networks_only', 'mutuals_only');--> statement-breakpoint
CREATE TABLE "intent_exclusions" (
	"intent_id" text NOT NULL,
	"excluded_user_id" text NOT NULL,
	CONSTRAINT "intent_exclusions_intent_id_excluded_user_id_pk" PRIMARY KEY("intent_id","excluded_user_id")
);
--> statement-breakpoint
ALTER TABLE "intent_networks" ADD COLUMN "visibility" "assignment_visibility" DEFAULT 'networks_only' NOT NULL;--> statement-breakpoint
UPDATE "intent_networks" SET "visibility" = 'mutuals_only' WHERE "intent_id" IN (SELECT "id" FROM "intents" WHERE "is_incognito");--> statement-breakpoint
ALTER TABLE "intents" ADD COLUMN "is_private" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "intents" DROP COLUMN "is_incognito";--> statement-breakpoint
ALTER TABLE "intent_exclusions" ADD CONSTRAINT "intent_exclusions_intent_id_intents_id_fk" FOREIGN KEY ("intent_id") REFERENCES "public"."intents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "intent_exclusions" ADD CONSTRAINT "intent_exclusions_excluded_user_id_users_id_fk" FOREIGN KEY ("excluded_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
