-- NegotiationGraph rewrite (design doc 2026-08-23): the round counter IS-A
-- bumps at every fresh kickoff, the negotiation task's own brief column, and
-- the `paused` task state the rewritten graph's turn loop pauses into.
--
-- In-flight negotiation task rows are NOT migrated to the new pause/brief
-- shape — this is a rewrite, not a dual-read. Any negotiation mid-flight at
-- deploy is orphaned; state this break in the PR.

ALTER TABLE "intents" ADD COLUMN "negotiation_round" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "brief" text;--> statement-breakpoint
ALTER TYPE "task_state" ADD VALUE IF NOT EXISTS 'paused';
