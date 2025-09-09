ALTER TABLE "index_links" RENAME TO "links";--> statement-breakpoint
ALTER TABLE "links" DROP CONSTRAINT "index_links_index_id_indexes_id_fk";
--> statement-breakpoint
ALTER TABLE "links" DROP CONSTRAINT "index_links_user_id_users_id_fk";
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "links" ADD CONSTRAINT "links_index_id_indexes_id_fk" FOREIGN KEY ("index_id") REFERENCES "public"."indexes"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "links" ADD CONSTRAINT "links_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
