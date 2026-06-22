CREATE TYPE "public"."question_status" AS ENUM('pending', 'answered', 'dismissed');--> statement-breakpoint
CREATE TABLE "questions" (
	"id" text PRIMARY KEY NOT NULL,
	"detection" jsonb NOT NULL,
	"actors" jsonb NOT NULL,
	"payload" jsonb NOT NULL,
	"status" "question_status" DEFAULT 'pending' NOT NULL,
	"answer" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "questions_status_idx" ON "questions" USING btree ("status");