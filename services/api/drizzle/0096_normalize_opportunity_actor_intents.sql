-- Normalize malformed model sentinels in persisted opportunity actors.
-- OpportunityActor.intent is optional, so null-like strings are represented by
-- removing the key rather than writing JSON null.
UPDATE "opportunities"
SET "actors" = (
  SELECT jsonb_agg(
    CASE
      WHEN jsonb_typeof(actor.value -> 'intent') = 'string'
        AND lower(btrim(actor.value ->> 'intent')) IN ('', 'null', 'undefined')
      THEN actor.value - 'intent'
      ELSE actor.value
    END
    ORDER BY actor.ordinality
  )
  FROM jsonb_array_elements(
    CASE
      WHEN jsonb_typeof("opportunities"."actors") = 'array' THEN "opportunities"."actors"
      ELSE '[]'::jsonb
    END
  ) WITH ORDINALITY AS actor(value, ordinality)
)
WHERE jsonb_typeof("actors") = 'array'
  AND EXISTS (
    SELECT 1
    FROM jsonb_array_elements(
      CASE
        WHEN jsonb_typeof("opportunities"."actors") = 'array' THEN "opportunities"."actors"
        ELSE '[]'::jsonb
      END
    ) AS actor(value)
    WHERE jsonb_typeof(actor.value -> 'intent') = 'string'
      AND lower(btrim(actor.value ->> 'intent')) IN ('', 'null', 'undefined')
  );--> statement-breakpoint
