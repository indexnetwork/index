ALTER TABLE "indexes" ALTER COLUMN "link_permissions" SET DATA TYPE json;--> statement-breakpoint
ALTER TABLE "indexes" ALTER COLUMN "link_permissions" SET DEFAULT 'null'::json;--> statement-breakpoint
ALTER TABLE "indexes" ALTER COLUMN "link_permissions" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "intro" text;