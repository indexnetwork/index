-- The round SIZE stamp (design doc 2026-08-23, decision D2).
--
-- Kickoff opens a round's negotiations in parallel and stamps how many it
-- actually opened only once every open has settled. Until the stamp exists
-- the all-paused → reflect check is a no-op: without it, an early first pause
-- sees zero working tasks before its siblings have created theirs, and the
-- deterministic reflect job id dedupes away the round's genuine reflect.
--
-- NULL means "this round is still opening". `bumpIntentNegotiationRound`
-- clears it, so a fresh round is never mistaken for a settled one.

ALTER TABLE "intents" ADD COLUMN "negotiation_round_size" integer;
