-- Normalize the retired negotiation vocabulary before the runtime stops
-- accepting it. `messages.parts` stores A2A data parts, each of which may
-- carry a negotiation turn at `data.action`.
--
-- The migration is deliberately fail-closed: `reject` is seat-sensitive, so
-- its sender must match the durable task initiator (or its source fallback)
-- or the durable candidate. A row that cannot prove that relationship is not
-- rewritten with a guessed meaning.

DO $$
DECLARE
  unsafe_count integer;
BEGIN
  SELECT count(*) INTO unsafe_count
  FROM "messages" m
  JOIN "tasks" t ON t."id" = m."task_id"
  CROSS JOIN LATERAL jsonb_array_elements(m."parts") AS p(part)
  WHERE t."metadata"->>'type' = 'negotiation'
    AND p.part->'data'->>'action' IN ('propose', 'reject')
    AND (
      COALESCE(t."metadata"->>'initiatorUserId', t."metadata"->>'sourceUserId') IS NULL
      OR (
        p.part->'data'->>'action' = 'reject'
        AND m."sender_id" NOT IN (
          COALESCE(t."metadata"->>'initiatorUserId', t."metadata"->>'sourceUserId'),
          t."metadata"->>'candidateUserId'
        )
      )
    );

  IF unsafe_count > 0 THEN
    RAISE EXCEPTION
      'Cannot normalize % negotiation turn(s): missing durable initiator/source metadata or unrecognized sender',
      unsafe_count;
  END IF;
END $$;--> statement-breakpoint

UPDATE "messages" m
SET "parts" = normalized.parts
FROM "tasks" t
CROSS JOIN LATERAL (
  SELECT jsonb_agg(
    CASE
      WHEN part.value->'data'->>'action' = 'propose' THEN
        jsonb_set(part.value, '{data,action}', '"outreach"'::jsonb)
      WHEN part.value->'data'->>'action' = 'reject'
           AND m."sender_id" = COALESCE(t."metadata"->>'initiatorUserId', t."metadata"->>'sourceUserId') THEN
        jsonb_set(part.value, '{data,action}', '"withdraw"'::jsonb)
      WHEN part.value->'data'->>'action' = 'reject' THEN
        jsonb_set(part.value, '{data,action}', '"decline"'::jsonb)
      ELSE part.value
    END
    ORDER BY part.ordinality
  ) AS parts
  FROM jsonb_array_elements(m."parts") WITH ORDINALITY AS part(value, ordinality)
) normalized
WHERE t."id" = m."task_id"
  AND t."metadata"->>'type' = 'negotiation'
  AND m."parts" @? '$[*].data.action ? (@ == "propose" || @ == "reject")';--> statement-breakpoint

-- Remove the obsolete marker only after every stored action is normalized.
UPDATE "tasks"
SET "metadata" = "metadata" - 'protocolVersion'
WHERE "metadata"->>'type' = 'negotiation'
  AND "metadata" ? 'protocolVersion';
