ALTER TABLE "files" DROP CONSTRAINT "files_index_id_indexes_id_fk";
--> statement-breakpoint
ALTER TABLE "links" DROP CONSTRAINT "links_index_id_indexes_id_fk";
--> statement-breakpoint
ALTER TABLE "files" DROP COLUMN IF EXISTS "index_id";--> statement-breakpoint
ALTER TABLE "links" DROP COLUMN IF EXISTS "index_id";