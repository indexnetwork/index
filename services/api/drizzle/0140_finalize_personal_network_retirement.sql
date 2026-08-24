-- `0139_retire_personal_networks` removed the runtime model and its marker
-- column. Keep the physical table removal in a separate, idempotent migration
-- so databases that recorded 0139 before the final DDL was applied converge on
-- the retired schema as well.

DROP TABLE IF EXISTS "personal_networks";
