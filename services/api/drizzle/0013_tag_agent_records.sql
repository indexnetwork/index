UPDATE "messages" m
SET "metadata" = jsonb_set(m."metadata", '{principalMessage,record}', to_jsonb(p."record")),
    "parts" = jsonb_set(m."parts", '{0,text}', to_jsonb(substr(m."parts"->0->>'text', length(p."prefix") + 1)))
FROM (VALUES
  ('Brief: ', 'brief'), ('Decision: ', 'decision'), ('Stall: ', 'stall'),
  ('Resolved: ', 'resolution'), ('Progress: ', 'progress')
) AS p("prefix", "record")
WHERE m."role" = 'agent'
  AND jsonb_typeof(m."metadata"->'principalMessage') = 'object'
  AND NOT (m."metadata"->'principalMessage' ? 'record')
  AND starts_with(m."parts"->0->>'text', p."prefix");
