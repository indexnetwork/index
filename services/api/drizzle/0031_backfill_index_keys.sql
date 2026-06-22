-- Backfill: generate keys from index titles for indexes that don't have one.
-- Keys are lowercase, kebab-case versions of the title.
-- Personal indexes are excluded (they don't need keys).
-- Handles collisions by appending a row-number suffix.
WITH candidates AS (
  SELECT
    id,
    lower(
      regexp_replace(
        regexp_replace(
          regexp_replace(title, '[^a-zA-Z0-9 -]', '', 'g'),
          '\s+', '-', 'g'
        ),
        '-+', '-', 'g'
      )
    ) AS base_key,
    ROW_NUMBER() OVER (
      PARTITION BY lower(
        regexp_replace(
          regexp_replace(
            regexp_replace(title, '[^a-zA-Z0-9 -]', '', 'g'),
            '\s+', '-', 'g'
          ),
          '-+', '-', 'g'
        )
      )
      ORDER BY created_at
    ) AS rn
  FROM indexes
  WHERE key IS NULL
    AND is_personal = false
    AND title IS NOT NULL
)
UPDATE indexes
SET key = CASE
  WHEN c.rn = 1 AND NOT EXISTS (SELECT 1 FROM indexes i2 WHERE i2.key = c.base_key)
    THEN c.base_key
  ELSE c.base_key || '-' || c.rn
END
FROM candidates c
WHERE indexes.id = c.id;
