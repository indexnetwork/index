-- One brief per SEAT (design doc 2026-08-23, decision D18).
--
-- `tasks.brief` was a single column written only by the initiator's kickoff
-- and read by whichever seat was speaking, so the counterparty's agent argued
-- the initiator's constraints as if they were its own principal's. A brief is
-- what a seat's own IS-A tells it about its own client, so it is now keyed by
-- the seat's user id.
--
-- No backfill. A seat with no entry authors its own brief at its first turn,
-- which is exactly the new lazy path — so an in-flight negotiation recovers by
-- using the mechanism rather than by a migration guessing on its behalf.

ALTER TABLE "tasks" ADD COLUMN "briefs" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "tasks" DROP COLUMN "brief";
