-- Single-path opportunities: one creation path, born at kickoff.
--
-- Discovery no longer persists opportunities; it records candidates, and the
-- row is INSERTed by createAndOpen when a principal's agent opens a
-- negotiation. Everything that fed the other five creation paths goes here.

-- 1. Rows from the deleted creation paths. Policy is delete-and-migrate, not
--    dual-read: nothing produces these shapes any more and no code reads them.
DELETE FROM opportunities
WHERE status IN ('latent', 'draft')
   OR detection->>'source' IN ('manual', 'enrichment', 'introducer_discovery')
   OR detection->>'source' IS NULL
   OR actors @> '[{"role": "introducer"}]'::jsonb;

-- 2. `approved` only ever meant "this introducer vouched for the introduction".
--    Strip it from any surviving actor.
UPDATE opportunities
SET actors = (
  SELECT COALESCE(jsonb_agg(actor - 'approved'), '[]'::jsonb)
  FROM jsonb_array_elements(actors) AS actor
)
WHERE actors::text LIKE '%"approved"%';

-- 3. Rebuild opportunity_status without the two pre-kickoff states. Postgres
--    cannot drop a value from an enum in place, so the type is replaced.
ALTER TYPE "opportunity_status" RENAME TO "opportunity_status_old";
CREATE TYPE "opportunity_status" AS ENUM ('negotiating', 'pending', 'stalled', 'accepted', 'rejected', 'expired');
ALTER TABLE "opportunities"
  ALTER COLUMN "status" DROP DEFAULT,
  ALTER COLUMN "status" TYPE "opportunity_status" USING "status"::text::"opportunity_status",
  ALTER COLUMN "status" SET DEFAULT 'pending';
DROP TYPE "opportunity_status_old";

-- 4. One live opportunity per pair.
--
--    The key is NORMALIZED with LEAST/GREATEST rather than reading actors[0]
--    and actors[1] positionally: nothing guarantees actor order on rows written
--    before this change, and a positional key would let the same pair through
--    twice by writing its seats the other way round.
--
--    Partial on both counts. Only active statuses, because a concluded pair may
--    legitimately be reopened later. And only where both seats carry an intent,
--    because a row without two seated intents is not a pair this model can
--    describe — grouping those on NULL would collide unrelated rows.
CREATE UNIQUE INDEX "opportunities_active_pair_idx"
  ON "opportunities" (
    (context->>'networkId'),
    LEAST(actors->0->>'intent', actors->1->>'intent'),
    GREATEST(actors->0->>'intent', actors->1->>'intent')
  )
  WHERE status IN ('negotiating', 'pending', 'stalled')
    AND actors->0->>'intent' IS NOT NULL
    AND actors->1->>'intent' IS NOT NULL;
