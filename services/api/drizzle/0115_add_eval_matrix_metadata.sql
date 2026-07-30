CREATE TABLE "eval_matrix_metadata" (
	"key" text PRIMARY KEY NOT NULL,
	"schema_migration_fingerprint" text NOT NULL,
	"fixture_fingerprint" text NOT NULL,
	"fixture_corpus_version" text NOT NULL,
	"seeded_at" timestamp with time zone NOT NULL
);
