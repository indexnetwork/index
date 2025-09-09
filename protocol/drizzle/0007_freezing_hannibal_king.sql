ALTER TABLE "files" ALTER COLUMN "index_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "index_links" ALTER COLUMN "index_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "files" ADD COLUMN "user_id" uuid;--> statement-breakpoint
ALTER TABLE "index_links" ADD COLUMN "user_id" uuid;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "files" ADD CONSTRAINT "files_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "index_links" ADD CONSTRAINT "index_links_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
