ALTER TABLE "user_integrations" RENAME TO "integrations";--> statement-breakpoint
ALTER TABLE "integrations" DROP CONSTRAINT "user_integrations_user_id_users_id_fk";
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "integrations" ADD CONSTRAINT "integrations_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
