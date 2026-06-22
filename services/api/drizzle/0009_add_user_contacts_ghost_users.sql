CREATE TYPE "public"."contact_source" AS ENUM('gmail', 'google_calendar', 'manual');--> statement-breakpoint
CREATE TABLE "user_contacts" (
	"id" text PRIMARY KEY NOT NULL,
	"owner_id" text NOT NULL,
	"user_id" text NOT NULL,
	"source" "contact_source" NOT NULL,
	"imported_at" timestamp DEFAULT now() NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"deleted_at" timestamp,
	CONSTRAINT "user_contacts_owner_id_user_id_unique" UNIQUE("owner_id","user_id")
);
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "is_ghost" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "user_contacts" ADD CONSTRAINT "user_contacts_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_contacts" ADD CONSTRAINT "user_contacts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "user_contacts_owner_idx" ON "user_contacts" USING btree ("owner_id");