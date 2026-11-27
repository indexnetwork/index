-- Contacts imported before 0030 have no rank until their owner syncs again, so
-- the matcher skips them. Rank them as rankContacts does with no frequency:
-- top 500 eligible per owner, saved contacts before emailed-only, oldest first.
-- Owners that already have a ranked contact are left as they are.
with ranked as (
  select c.id,
         row_number() over (
           partition by c.owner_user_id
           order by (c.source = 'google_contacts') desc, c.created_at asc, c.id
         ) as pos
  from contacts c
  where c.removed_at is null and c.excluded_at is null and c.matched_user_id is null
    and not exists (select 1 from contacts r where r.owner_user_id = c.owner_user_id and r.rank is not null)
)
update contacts c
set rank = r.pos::int
from ranked r
where c.id = r.id and r.pos <= 500;
