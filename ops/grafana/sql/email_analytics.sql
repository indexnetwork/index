-- Read-only view for the Index - Email board. Run once as the database owner,
-- after the 0014_email_events migration has created public.email_events.
-- The view exposes no recipient and no subject: the table has neither.
create or replace view analytics.email_events as
  select occurred_at as at, type, kind, email_id
  from public.email_events;

grant select on analytics.email_events to grafana_ro;
