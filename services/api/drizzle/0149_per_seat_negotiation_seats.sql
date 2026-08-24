-- A negotiation binds a signal PER SEAT (design doc 2026-08-23, decision D21).
--
-- `metadata.intentId` / `metadata.round` were single-valued and held the
-- OPENING signal's binding, but a negotiation genuinely belongs to two
-- signals — one per seat — exactly as its briefs do. With one owning intent a
-- re-kick from the other side either overwrote the opener's round or had to be
-- refused, and the counterparty's agent could speak here but never promote or
-- reject: the design doc's rule is that a side which wants out pauses
-- ready_for_verdict(reject) and ITS OWN IS-A rejects, so single ownership
-- silently deleted half the loop's terminators.
--
-- `metadata.seats` is keyed by intent id, one entry per seat that has kicked
-- this negotiation off: { "<intentId>": { "userId": ..., "round": N } }.
--
-- Backfilled rather than orphaned: the opener's binding is exactly what the
-- two old keys already recorded, so the move is lossless and one statement.
-- `metadata ? 'seats'` is also the new rewrite-era predicate, so a row left
-- unmigrated would go inert to the whole lifecycle.

UPDATE "tasks"
SET "metadata" = ("metadata" - 'intentId' - 'round') || jsonb_build_object(
      'seats', jsonb_build_object(
        "metadata"->>'intentId',
        jsonb_build_object('userId', "metadata"->>'sourceUserId', 'round', ("metadata"->>'round')::int)
      )
    )
WHERE "metadata"->>'type' = 'negotiation'
  AND "metadata" ? 'intentId'
  AND "metadata" ? 'round'
  AND "metadata" ? 'sourceUserId';
