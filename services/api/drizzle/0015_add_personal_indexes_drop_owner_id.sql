CREATE TABLE IF NOT EXISTS "personal_indexes" (
	"user_id" text NOT NULL,
	"index_id" text NOT NULL,
	CONSTRAINT "personal_indexes_user_id_pk" PRIMARY KEY("user_id")
);
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'personal_indexes_user_id_users_id_fk'
  ) THEN
    ALTER TABLE "personal_indexes" ADD CONSTRAINT "personal_indexes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
  END IF;
END $$;--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'personal_indexes_index_id_indexes_id_fk'
  ) THEN
    ALTER TABLE "personal_indexes" ADD CONSTRAINT "personal_indexes_index_id_indexes_id_fk" FOREIGN KEY ("index_id") REFERENCES "public"."indexes"("id") ON DELETE no action ON UPDATE no action;
  END IF;
END $$;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "personal_indexes_index_id_unique" ON "personal_indexes" USING btree ("index_id");--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'indexes' AND column_name = 'owner_id'
  ) THEN
    EXECUTE 'INSERT INTO "personal_indexes" ("user_id", "index_id") SELECT "owner_id", "id" FROM "indexes" WHERE "is_personal" = true AND "owner_id" IS NOT NULL ON CONFLICT DO NOTHING';
  END IF;
END $$;--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'personal_owner_check'
  ) THEN
    ALTER TABLE "indexes" DROP CONSTRAINT "personal_owner_check";
  END IF;
END $$;--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'indexes_owner_id_users_id_fk'
  ) THEN
    ALTER TABLE "indexes" DROP CONSTRAINT "indexes_owner_id_users_id_fk";
  END IF;
END $$;
--> statement-breakpoint
DROP INDEX IF EXISTS "indexes_is_personal_owner";--> statement-breakpoint
ALTER TABLE "indexes" DROP COLUMN IF EXISTS "owner_id";
