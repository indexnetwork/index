-- Read-only view for the Index - Email board. Run once as the database owner,
-- after the 0015_email_events migration has created public.email_events.
-- The view carries the user id, so counts can be taken per user and joined to the
-- other analytics views. It has no recipient address and no subject: the table has neither.
create or replace view analytics.email_events as
  select occurred_at as at, type, kind, email_id, user_id
  from public.email_events;

grant select on analytics.email_events to grafana_ro;
