-- Backfill: rename indexId → networkId inside opportunities JSONB columns.
-- The 0030 migration renamed the tables/columns but did not update JSON payload
-- keys inside opportunities.actors (OpportunityActor[]) and
-- opportunities.context (OpportunityContext), which still carry "indexId" in
-- rows created before the rename. This migration fixes those rows in-place.

-- 1. Update actors array: rename "indexId" → "networkId" in each element
UPDATE "opportunities"
SET "actors" = (
  SELECT jsonb_agg(
    CASE
      WHEN elem ? 'indexId'
      THEN (elem - 'indexId') || jsonb_build_object('networkId', elem -> 'indexId')
      ELSE elem
    END
  )
  FROM jsonb_array_elements("actors"::jsonb) AS elem
)
WHERE "actors"::jsonb @> '[{"indexId": null}]'
   OR "actors"::text LIKE '%"indexId"%';--> statement-breakpoint

-- 2. Update context object: rename "indexId" → "networkId"
UPDATE "opportunities"
SET "context" = ("context"::jsonb - 'indexId') || jsonb_build_object('networkId', "context"::jsonb -> 'indexId')
WHERE "context"::jsonb ? 'indexId';
