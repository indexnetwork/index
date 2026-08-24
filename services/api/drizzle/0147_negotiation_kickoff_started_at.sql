-- The kickoff-in-progress marker (design doc 2026-08-23, decisions D2/D29).
--
-- `negotiation_round_size` alone cannot say whether a round was ever kicked
-- off: NULL means both "this kickoff has not finished" and "no kickoff has
-- ever run here", and every intent that predates 0146 is in the second state
-- while looking exactly like the first. A kickoff that resumed on that
-- signature would silently drop a pre-existing signal's first real batch of
-- matches.
--
-- This column is stamped by the round bump — the one write that begins a
-- kickoff — and read together with the size:
--   started_at NULL                  → no kickoff has begun (legacy intents)
--   started_at set, size NULL        → a kickoff began and did not finish
--   size not NULL                    → the round is settled
--
-- Left NULL for every existing row on purpose: their next matches_ready runs
-- a normal kickoff.

ALTER TABLE "intents" ADD COLUMN "negotiation_kickoff_started_at" timestamp with time zone;
