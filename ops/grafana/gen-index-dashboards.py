import json, os, re, sys

DS = {"type": "grafana-postgresql-datasource", "uid": "index-pg"}
ACTS = """acts as (
  select user_id as u, created_at as t from analytics.intents
  union all select sender_id, created_at from analytics.messages
  union all select actor_user_id, at from analytics.opportunity_events where type = 'committed'
)"""
WK = ACTS + """,
wk as (select distinct a.u, date_trunc('week', a.t) as w from acts a join analytics.users us on us.id = a.u),
fst as (select u, min(w) as fw from wk group by u)"""


def target(sql, fmt):
    return {"refId": "A", "datasource": DS, "format": fmt, "rawQuery": True, "editorMode": "code", "rawSql": sql}


def stat(i, title, sql, x, y, unit="short", w=4, decimals=None):
    if decimals is None:
        decimals = 1 if unit != "short" else 0
    return {"id": i, "type": "stat", "title": title, "datasource": DS, "gridPos": {"x": x, "y": y, "w": w, "h": 4},
            "fieldConfig": {"defaults": {"unit": unit, "decimals": decimals}, "overrides": []},
            "options": {"reduceOptions": {"calcs": ["lastNotNull"], "fields": "", "values": False}, "colorMode": "none"},
            "targets": [target(sql, "table")]}


def ts(i, title, sql, x, y, w=12, h=8, unit="short", stack=False):
    custom = {"drawStyle": "bars", "fillOpacity": 70, "stacking": {"mode": "normal"}} if stack else {"drawStyle": "line", "fillOpacity": 10}
    return {"id": i, "type": "timeseries", "title": title, "datasource": DS, "gridPos": {"x": x, "y": y, "w": w, "h": h},
            "fieldConfig": {"defaults": {"unit": unit, "custom": custom}, "overrides": []},
            "options": {"legend": {"displayMode": "list", "placement": "bottom"}},
            "targets": [target(sql, "time_series")]}


def bars(i, title, sql, x, y, w=12, h=8):
    return {"id": i, "type": "bargauge", "title": title, "datasource": DS, "gridPos": {"x": x, "y": y, "w": w, "h": h},
            "fieldConfig": {"defaults": {}, "overrides": []},
            "options": {"orientation": "horizontal", "displayMode": "gradient", "reduceOptions": {"calcs": ["lastNotNull"], "fields": "", "values": True}},
            "targets": [target(sql, "table")]}


def table(i, title, sql, x, y, w=12, h=8):
    return {"id": i, "type": "table", "title": title, "datasource": DS, "gridPos": {"x": x, "y": y, "w": w, "h": h},
            "fieldConfig": {"defaults": {}, "overrides": []}, "options": {}, "targets": [target(sql, "table")]}


def row(i, title, y):
    return {"id": i, "type": "row", "title": title, "collapsed": False,
            "gridPos": {"h": 1, "w": 24, "x": 0, "y": y}, "panels": []}


def dash(uid, title, panels, rng="now-30d"):
    return {"uid": uid, "title": title, "tags": ["index"], "timezone": "utc", "schemaVersion": 39, "version": 1,
            "refresh": "5m", "time": {"from": rng, "to": "now"}, "panels": panels, "templating": {"list": []}}


def described(panel, text):
    return {**panel, "description": text}


def ev(t, expr="count(distinct opportunity_id)"):
    return f"select {expr} as value from analytics.opportunity_events where type = '{t}' and $__timeFilter(at)"


activation = dash("index-activation", "Index - Activation funnel", [
    bars(1, "Funnel: users who signed up in range and reached each step", """select step, users from (
  with c as (select id from analytics.users where deleted_at is null and $__timeFilter(created_at)),
  i as (select distinct user_id as u from analytics.intents),
  d as (select distinct user_id as u from analytics.intents where first_discovery_succeeded_at is not null),
  o as (select distinct ou.user_id as u from analytics.opportunity_users ou join analytics.opportunity_events e on e.opportunity_id = ou.opportunity_id and e.type = 'opened'),
  k as (select distinct actor_user_id as u from analytics.opportunity_events where type = 'committed')
  select '1 Signed up' as step, count(*) as users from c
  union all select '2 Created first intent', count(*) from c join i on i.u = c.id
  union all select '3 First discovery succeeded', count(*) from c join d on d.u = c.id
  union all select '4 Opportunity opened', count(*) from c join o on o.u = c.id
  union all select '5 Committed to an opportunity', count(*) from c join k on k.u = c.id
) f order by step""", 0, 0, 24, 8),
    ts(2, "Signups per day", "select $__timeGroupAlias(created_at,'1d'), count(*) as signups from analytics.users where $__timeFilter(created_at) group by 1 order by 1", 0, 8, stack=True),
    ts(3, "Users creating their first intent per day", "select $__timeGroupAlias(first_at,'1d'), count(*) as first_intents from (select user_id, min(created_at) as first_at from analytics.intents group by 1) f where $__timeFilter(first_at) group by 1 order by 1", 12, 8, stack=True),
    ts(4, "Time from signup to first intent (median hours, by signup week)", "select date_trunc('week', u.created_at) as time, percentile_cont(0.5) within group (order by extract(epoch from (f.first_at - u.created_at))/3600) as median_hours from analytics.users u join (select user_id, min(created_at) as first_at from analytics.intents group by 1) f on f.user_id = u.id where $__timeFilter(u.created_at) group by 1 order by 1", 0, 16, 24),
])

opportunity = dash("index-opportunity", "Index - Opportunity quality", [
    stat(1, "Opened", ev("opened"), 0, 0), stat(2, "Agreed by negotiators", ev("agreed"), 4, 0),
    stat(3, "Committed (any side)", ev("committed"), 8, 0),
    stat(4, "Mutual (both sides committed)", "select count(*) as value from (select opportunity_id from analytics.opportunity_events where type = 'committed' and $__timeFilter(at) group by 1 having count(distinct actor_user_id) >= 2) m", 12, 0),
    stat(5, "Declined", ev("declined"), 16, 0), stat(6, "Expired", ev("expired"), 20, 0),
    stat(7, "Commit rate (committed / agreed)", "select count(distinct opportunity_id) filter (where type = 'committed')::float / nullif(count(distinct opportunity_id) filter (where type = 'agreed'), 0) as value from analytics.opportunity_events where $__timeFilter(at)", 0, 4, "percentunit", 8),
    stat(8, "Median hours from opened to first commit", "select percentile_cont(0.5) within group (order by extract(epoch from (c.t - o.at))/3600) as value from (select opportunity_id, at from analytics.opportunity_events where type = 'opened' and $__timeFilter(at)) o join (select opportunity_id, min(at) as t from analytics.opportunity_events where type = 'committed' group by 1) c using (opportunity_id)", 8, 4, "h", 8),
    stat(9, "Decline rate (declined / opened)", "select count(distinct opportunity_id) filter (where type = 'declined')::float / nullif(count(distinct opportunity_id) filter (where type = 'opened'), 0) as value from analytics.opportunity_events where $__timeFilter(at)", 16, 4, "percentunit", 8),
    ts(10, "Opportunity events per day", "select $__timeGroupAlias(at,'1d'), type as metric, count(*) as value from analytics.opportunity_events where $__timeFilter(at) group by 1,2 order by 1", 0, 8, 24, 9, stack=True),
    ts(11, "Daily commit rate (committed / agreed)", "select $__timeGroupAlias(at,'1d'), count(distinct opportunity_id) filter (where type = 'committed')::float / nullif(count(distinct opportunity_id) filter (where type = 'agreed'), 0) as commit_rate from analytics.opportunity_events where $__timeFilter(at) group by 1 order by 1", 0, 17, 24, unit="percentunit"),
])

negotiation = dash("index-negotiation", "Index - Negotiation health", [
    stat(1, "Negotiations started", "select count(*) as value from analytics.negotiations where $__timeFilter(created_at)", 0, 0, w=6),
    stat(2, "Agreement rate (agreed / settled)", "select count(*) filter (where outcome = 'agreed')::float / nullif(count(*) filter (where outcome is not null), 0) as value from analytics.negotiations where $__timeFilter(created_at)", 6, 0, "percentunit", 6),
    stat(3, "Open now (awaiting a seat)", "select count(*) as value from analytics.negotiations where outcome is null", 12, 0, w=6),
    stat(4, "Open for more than 24h", "select count(*) as value from analytics.negotiations where outcome is null and created_at < now() - interval '24 hours'", 18, 0, w=6),
    ts(5, "Negotiations started per day by outcome", "select $__timeGroupAlias(created_at,'1d'), coalesce(outcome, 'in progress') as metric, count(*) as value from analytics.negotiations where $__timeFilter(created_at) group by 1,2 order by 1", 0, 4, 24, 9, stack=True),
    stat(6, "Median turns per negotiation", "select percentile_cont(0.5) within group (order by n) as value from (select t.negotiation_id, count(*) as n from analytics.negotiation_turns t join analytics.negotiations g on g.id = t.negotiation_id where $__timeFilter(g.created_at) group by 1) x", 0, 13, w=6),
    stat(7, "Median hours to settle", "select percentile_cont(0.5) within group (order by extract(epoch from (settled_at - created_at))/3600) as value from analytics.negotiations where settled_at is not null and $__timeFilter(created_at)", 6, 13, "h", 6),
    bars(8, "Turns by action", "select action, count(*) as turns from analytics.negotiation_turns where $__timeFilter(created_at) group by 1 order by 2 desc", 12, 13, 12, 8),
])

retention = dash("index-retention", "Index - Retention", [
    stat(1, "Weekly active users (last 7d)", "with " + ACTS + " select count(distinct a.u) as value from acts a join analytics.users us on us.id = a.u where a.t > now() - interval '7 days'", 0, 0, w=6),
    stat(2, "Total users", "select count(*) as value from analytics.users where deleted_at is null", 6, 0, w=6),
    stat(3, "Accounts deleted in range", "select count(*) as value from analytics.users where deleted_at is not null and $__timeFilter(deleted_at)", 12, 0, w=6),
    stat(4, "Signups in range", "select count(*) as value from analytics.users where $__timeFilter(created_at)", 18, 0, w=6),
    ts(5, "Weekly active users: new vs returning", "with " + WK + """
select w as time, count(*) filter (where w = fw) as new_users, count(*) filter (where w > fw) as returning_users from wk join fst using (u) where $__timeFilter(w) group by w order by w""", 0, 4, 24, 9, stack=True),
    ts(6, "Week-over-week retention (share of last week's actives active again)", "with " + WK + """
select p.w + interval '7 days' as time, count(c.u)::float / count(*) as retention from wk p left join wk c on c.u = p.u and c.w = p.w + interval '7 days' where p.w + interval '7 days' <= date_trunc('week', now()) and $__timeFilter(p.w + interval '7 days') group by 1 order by 1""", 0, 13, 12, unit="percentunit"),
    ts(7, "Accounts deleted per week", "select date_trunc('week', deleted_at) as time, count(*) as deleted from analytics.users where deleted_at is not null and $__timeFilter(deleted_at) group by 1 order by 1", 12, 13, stack=True),
    described(ts(8, "Weekly active users: how many clicked an email that week", "with " + WK + """
select w as time, count(*) as active_users, count(*) filter (where exists (select 1 from analytics.email_events e where e.user_id = wk.u and e.type = 'clicked' and date_trunc('week', e.at) = wk.w)) as active_and_clicked_email from wk where $__timeFilter(w) group by w order by w""", 0, 22, 24),
              "Needs the email tracking setup. Counts people active in the week who also clicked a tracked email in it; it does not show that the email caused the activity."),
], "now-90d")

supply = dash("index-supply", "Index - Supply", [
    stat(1, "Active intents", "select count(*) as value from analytics.intents where status = 'active' and archived_at is null", 0, 0, w=6),
    stat(2, "Weekly active users (last 7d)", "with " + ACTS + " select count(distinct a.u) as value from acts a join analytics.users us on us.id = a.u where a.t > now() - interval '7 days'", 6, 0, w=6),
    stat(3, "Active intents per weekly active user", "with " + ACTS + ", w as (select count(distinct a.u) as n from acts a join analytics.users us on us.id = a.u where a.t > now() - interval '7 days') select (select count(*) from analytics.intents where status = 'active' and archived_at is null)::float / nullif((select n from w), 0) as value", 12, 0, w=6),
    stat(4, "Networks with no activity in 14d", """select count(*) as value from analytics.networks n
left join (select network_id, max(created_at) as t from analytics.intent_networks group by 1) ia on ia.network_id = n.id
left join (select network_id, max(created_at) as t from analytics.opportunity_networks group by 1) op on op.network_id = n.id
where n.deleted_at is null and coalesce(ia.t, 'epoch'::timestamptz) < now() - interval '14 days' and coalesce(op.t, 'epoch'::timestamptz) < now() - interval '14 days'""", 18, 0, w=6),
    ts(5, "Intents created and archived per day", "select $__timeGroupAlias(created_at,'1d'), 'created' as metric, count(*) as value from analytics.intents where $__timeFilter(created_at) group by 1 union all select $__timeGroupAlias(archived_at,'1d'), 'archived', count(*) from analytics.intents where archived_at is not null and $__timeFilter(archived_at) group by 1 order by 1", 0, 4, 24, 9, stack=True),
    table(6, "Dormant networks (no intent assignment and no opportunity in 14d)", """select n.id as network, coalesce(m.members, 0) as members, ia.t as last_intent_assignment, op.t as last_opportunity
from analytics.networks n
left join (select network_id, count(*) as members from analytics.network_members where deleted_at is null group by 1) m on m.network_id = n.id
left join (select network_id, max(created_at) as t from analytics.intent_networks group by 1) ia on ia.network_id = n.id
left join (select network_id, max(created_at) as t from analytics.opportunity_networks group by 1) op on op.network_id = n.id
where n.deleted_at is null and coalesce(ia.t, 'epoch'::timestamptz) < now() - interval '14 days' and coalesce(op.t, 'epoch'::timestamptz) < now() - interval '14 days'
order by members desc limit 50""", 0, 13, 24, 10),
])


def mail(t, expr="count(*)"):
    return f"select {expr} as value from analytics.email_events where type = '{t}' and $__timeFilter(at)"


EVENT_DAY = "Counted on the day each event happened, not the day the email was sent, so a rate can pass 100% on a day with late opens."

email = dash("index-email", "Index - Email", [
    stat(1, "Sent", mail("sent"), 0, 0), stat(2, "Delivered", mail("delivered"), 4, 0),
    stat(3, "Opened (unique emails)", mail("opened", "count(distinct email_id)"), 8, 0),
    stat(4, "Clicked (unique emails)", mail("clicked", "count(distinct email_id)"), 12, 0),
    stat(5, "Bounced", mail("bounced"), 16, 0), stat(6, "Marked as spam", mail("complained"), 20, 0),
    described(stat(7, "Open rate (unique opens / delivered)", "select count(distinct email_id) filter (where type = 'opened')::float / nullif(count(*) filter (where type = 'delivered'), 0) as value from analytics.email_events where $__timeFilter(at)", 0, 4, "percentunit", 8),
              "Apple Mail Privacy Protection and some security scanners open emails automatically, so opens overstate real reading."),
    stat(8, "Click rate (unique clicks / delivered)", "select count(distinct email_id) filter (where type = 'clicked')::float / nullif(count(*) filter (where type = 'delivered'), 0) as value from analytics.email_events where $__timeFilter(at)", 8, 4, "percentunit", 8),
    stat(9, "Click-to-open rate (unique clicks / unique opens)", "select count(distinct email_id) filter (where type = 'clicked')::float / nullif(count(distinct email_id) filter (where type = 'opened'), 0) as value from analytics.email_events where $__timeFilter(at)", 16, 4, "percentunit", 8),
    stat(10, "Users emailed", "select count(distinct user_id) as value from analytics.email_events where type = 'sent' and $__timeFilter(at)", 0, 8, w=6),
    stat(11, "Users who opened", "select count(distinct user_id) as value from analytics.email_events where type = 'opened' and $__timeFilter(at)", 6, 8, w=6),
    stat(12, "Users who clicked", "select count(distinct user_id) as value from analytics.email_events where type = 'clicked' and $__timeFilter(at)", 12, 8, w=6),
    described(stat(13, "Users who clicked, then were active within 24h", "with " + ACTS + " select count(distinct e.user_id) as value from analytics.email_events e where e.type = 'clicked' and $__timeFilter(e.at) and exists (select 1 from acts a where a.u = e.user_id and a.t > e.at and a.t <= e.at + interval '24 hours')", 18, 8, w=6),
              "Activity is a new intent, a message or a commit after the click. It shows people came back, not that the email caused it."),
    described(stat(14, "Emailed users who never opened (share)", "select 1 - count(distinct user_id) filter (where type = 'opened')::float / nullif(count(distinct user_id) filter (where type = 'sent'), 0) as value from analytics.email_events where $__timeFilter(at)", 0, 12, "percentunit", 8),
              "Of the users sent a tracked email in the range, the share with no open event in it. Open tracking misses people who block images."),
    ts(15, "Users per day: emailed, opened, clicked", "select $__timeGroupAlias(at,'1d'), count(distinct user_id) filter (where type = 'sent') as emailed, count(distinct user_id) filter (where type = 'opened') as opened, count(distinct user_id) filter (where type = 'clicked') as clicked from analytics.email_events where $__timeFilter(at) group by 1 order by 1", 8, 12, 16, 4),
    bars(16, "Emailed users by number of opens in range", """select bucket, users from (
  with s as (select user_id, count(*) filter (where type = 'opened') as opens from analytics.email_events where user_id is not null and $__timeFilter(at) group by 1 having count(*) filter (where type = 'sent') > 0)
  select '1 none' as bucket, count(*) as users from s where opens = 0
  union all select '2 one', count(*) from s where opens = 1
  union all select '3 two to four', count(*) from s where opens between 2 and 4
  union all select '4 five or more', count(*) from s where opens >= 5
) b order by bucket""", 0, 16, 24, 6),
    ts(17, "Sent per day by email type", "select $__timeGroupAlias(at,'1d'), coalesce(kind, 'untagged') as metric, count(*) as value from analytics.email_events where type = 'sent' and $__timeFilter(at) group by 1,2 order by 1", 0, 22, 24, 9, stack=True),
    described(ts(18, "Opens per day", "select $__timeGroupAlias(at,'1d'), count(*) as opens, count(distinct email_id) as unique_opens from analytics.email_events where type = 'opened' and $__timeFilter(at) group by 1 order by 1", 0, 31, 12),
              "Opens counts every open event. Unique opens counts each email once per day."),
    described(ts(19, "Clicks per day", "select $__timeGroupAlias(at,'1d'), count(*) as clicks, count(distinct email_id) as unique_clicks from analytics.email_events where type = 'clicked' and $__timeFilter(at) group by 1 order by 1", 12, 31, 12),
              "Clicks counts every click event. Unique clicks counts each email once per day."),
    described(ts(20, "Daily open and click rate", "select $__timeGroupAlias(at,'1d'), count(distinct email_id) filter (where type = 'opened')::float / nullif(count(*) filter (where type = 'delivered'), 0) as open_rate, count(distinct email_id) filter (where type = 'clicked')::float / nullif(count(*) filter (where type = 'delivered'), 0) as click_rate from analytics.email_events where $__timeFilter(at) group by 1 order by 1", 0, 40, 12, unit="percentunit"), EVENT_DAY),
    ts(21, "Delivery problems per day", "select $__timeGroupAlias(at,'1d'), type as metric, count(*) as value from analytics.email_events where type in ('bounced', 'complained', 'failed', 'delivery_delayed') and $__timeFilter(at) group by 1,2 order by 1", 12, 40, 12, stack=True),
    table(22, "By email type", """select coalesce(kind, 'untagged') as email_type,
  count(*) filter (where type = 'sent') as sent,
  count(*) filter (where type = 'delivered') as delivered,
  count(distinct email_id) filter (where type = 'opened') as unique_opens,
  count(distinct email_id) filter (where type = 'clicked') as unique_clicks,
  count(distinct user_id) filter (where type = 'opened') as users_opened,
  count(distinct user_id) filter (where type = 'clicked') as users_clicked,
  count(distinct email_id) filter (where type = 'opened')::float / nullif(count(*) filter (where type = 'delivered'), 0) as open_rate,
  count(distinct email_id) filter (where type = 'clicked')::float / nullif(count(*) filter (where type = 'delivered'), 0) as click_rate,
  count(*) filter (where type = 'bounced') as bounced,
  count(*) filter (where type = 'complained') as complained
from analytics.email_events where $__timeFilter(at) group by 1 order by sent desc""", 0, 49, 24, 8),
])

# People, not volume. Counts only: the board never lists a user id.
SENT_USERS = """s as (
  select user_id,
    count(*) filter (where type = 'sent') as sent,
    count(distinct email_id) filter (where type = 'clicked') as clicks,
    count(distinct email_id) filter (where type = 'opened') as opens
  from analytics.email_events
  where user_id is not null and $__timeFilter(at)
  group by 1
  having count(*) filter (where type = 'sent') > 0
)"""

health = dash("index-email-health", "Index - Email health", [
    row(100, "Too much mail", 0),
    described(stat(1, "Users sent 5 or more", "with " + SENT_USERS + " select count(*) as value from s where sent >= 5", 0, 1, w=5),
              "Five tracked emails to one person in the selected range."),
    described(stat(2, "Extra morning brief on one day", """with d as (
  select user_id, date_trunc('day', at) as day, count(*) as n
  from analytics.email_events
  where type = 'sent' and kind = 'morning_brief' and user_id is not null and $__timeFilter(at)
  group by 1, 2
) select count(distinct user_id) as value from d where n > 1""", 5, 1, w=5),
              "A morning brief is one a day. This counts users sent more than one on the same UTC day."),
    described(stat(3, "3 or more message emails on one day", """with d as (
  select user_id, date_trunc('day', at) as day, count(*) as n
  from analytics.email_events
  where type = 'sent' and kind = 'message' and user_id is not null and $__timeFilter(at)
  group by 1, 2
) select count(distinct user_id) as value from d where n >= 3""", 10, 1, w=5),
              "Message mail waits one minute after the latest message, then sends. Three in a day is three separate bursts."),
    stat(4, "Most emails to one user", """select coalesce(max(n), 0) as value from (
  select count(*) as n from analytics.email_events
  where type = 'sent' and user_id is not null and $__timeFilter(at) group by user_id
) s""", 15, 1, w=4),
    stat(5, "Median emails per user", """select coalesce(percentile_cont(0.5) within group (order by n), 0) as value from (
  select count(*) as n from analytics.email_events
  where type = 'sent' and user_id is not null and $__timeFilter(at) group by user_id
) s""", 19, 1, w=5, decimals=1),
    bars(6, "Users by emails received", """select bucket, users from (
  with """ + SENT_USERS + """
  select '1 one' as bucket, count(*) as users from s where sent = 1
  union all select '2 two', count(*) from s where sent = 2
  union all select '3 three or four', count(*) from s where sent between 3 and 4
  union all select '4 five to nine', count(*) from s where sent between 5 and 9
  union all select '5 ten or more', count(*) from s where sent >= 10
) b order by bucket""", 0, 5, 12, 8),
    described(ts(7, "Heavy days", """select day as time,
  count(*) filter (where briefs > 1) as extra_morning_brief,
  count(*) filter (where messages >= 3) as message_bursts
from (
  select user_id, date_trunc('day', at) as day,
    count(*) filter (where kind = 'morning_brief') as briefs,
    count(*) filter (where kind = 'message') as messages
  from analytics.email_events
  where type = 'sent' and user_id is not null and $__timeFilter(at)
  group by 1, 2
) d group by day order by day""", 12, 5, 12, 8),
              "Users that day who got a second morning brief, or three or more message emails."),
    table(8, "Volume by email type", """select coalesce(kind, 'untagged') as email_type,
  count(*) filter (where type = 'sent') as sent,
  count(distinct user_id) filter (where type = 'sent') as users,
  count(*) filter (where type = 'sent')::float / nullif(count(distinct user_id) filter (where type = 'sent'), 0) as emails_per_user,
  count(distinct user_id) filter (where type = 'clicked') as users_who_clicked
from analytics.email_events where $__timeFilter(at) group by 1 order by sent desc""", 0, 13, 24, 8),
    row(101, "Not engaging", 21),
    described(stat(9, "Emailed users with no click", "with " + SENT_USERS + " select count(*) filter (where clicks = 0)::float / nullif(count(*), 0) as value from s", 0, 22, "percentunit", 5),
              "Clicks are the reliable signal. Opens include automatic privacy fetches."),
    described(stat(10, "3 or more emails, no click", "with " + SENT_USERS + " select count(*) as value from s where sent >= 3 and clicks = 0", 5, 22, w=5),
              "Sent at least three tracked emails in the range and never clicked one."),
    described(stat(11, "3 or more emails, no open", "with " + SENT_USERS + " select count(*) as value from s where sent >= 3 and opens = 0", 10, 22, w=5),
              "Open tracking misses people who block images, so this undercounts readers."),
    described(stat(12, "Morning brief, never clicked", """with s as (
  select user_id,
    count(*) filter (where type = 'sent' and kind = 'morning_brief') as sent,
    count(distinct email_id) filter (where type = 'clicked' and kind = 'morning_brief') as clicks
  from analytics.email_events where user_id is not null and $__timeFilter(at)
  group by 1
  having count(*) filter (where type = 'sent' and kind = 'morning_brief') > 0
) select count(*) as value from s where clicks = 0""", 15, 22, w=5),
              "Users sent a morning brief in the range who never clicked one."),
    described(stat(13, "Message email, never clicked", """with s as (
  select user_id,
    count(*) filter (where type = 'sent' and kind = 'message') as sent,
    count(distinct email_id) filter (where type = 'clicked' and kind = 'message') as clicks
  from analytics.email_events where user_id is not null and $__timeFilter(at)
  group by 1
  having count(*) filter (where type = 'sent' and kind = 'message') > 0
) select count(*) as value from s where clicks = 0""", 20, 22, w=4),
              "Users sent a message email in the range who never clicked one."),
    bars(14, "Emailed users by clicks", """select bucket, users from (
  with """ + SENT_USERS + """
  select '1 none' as bucket, count(*) as users from s where clicks = 0
  union all select '2 one', count(*) from s where clicks = 1
  union all select '3 two or more', count(*) from s where clicks >= 2
) b order by bucket""", 0, 26, 12, 8),
    described(ts(15, "Emailed that day, no click in the range", """with clicks as (
  select distinct user_id from analytics.email_events
  where type = 'clicked' and user_id is not null and $__timeFilter(at)
)
select date_trunc('day', at) as time,
  count(distinct user_id) as emailed,
  count(distinct user_id) filter (where user_id not in (select user_id from clicks)) as no_click
from analytics.email_events
where type = 'sent' and user_id is not null and $__timeFilter(at)
group by 1 order by 1""", 12, 26, 12, 8),
              "No click means no click anywhere in the selected range, not only on that day."),
    table(16, "Engagement by email type", """select coalesce(kind, 'untagged') as email_type,
  count(distinct user_id) filter (where type = 'sent') as users_emailed,
  count(distinct user_id) filter (where type = 'clicked') as users_clicked,
  count(distinct user_id) filter (where type = 'opened') as users_opened,
  count(distinct user_id) filter (where type = 'clicked')::float / nullif(count(distinct user_id) filter (where type = 'sent'), 0) as click_share
from analytics.email_events where $__timeFilter(at) group by 1 order by users_emailed desc""", 0, 34, 24, 8),
    row(102, "Mail that should have stopped", 42),
    stat(17, "Users who bounced", "select count(distinct user_id) as value from analytics.email_events where type = 'bounced' and $__timeFilter(at)", 0, 43, w=5),
    stat(18, "Users who marked mail as spam", "select count(distinct user_id) as value from analytics.email_events where type = 'complained' and $__timeFilter(at)", 5, 43, w=5),
    described(stat(19, "Emailed after a bounce", """with b as (
  select user_id, min(at) as first_at from analytics.email_events
  where type = 'bounced' and user_id is not null and $__timeFilter(at) group by 1
) select count(distinct e.user_id) as value from analytics.email_events e
  join b on b.user_id = e.user_id
  where e.type = 'sent' and e.at > b.first_at and $__timeFilter(e.at)""", 10, 43, w=5),
              "A send in the range after that user's first bounce in the range."),
    described(stat(20, "Emailed after a spam report", """with b as (
  select user_id, min(at) as first_at from analytics.email_events
  where type = 'complained' and user_id is not null and $__timeFilter(at) group by 1
) select count(distinct e.user_id) as value from analytics.email_events e
  join b on b.user_id = e.user_id
  where e.type = 'sent' and e.at > b.first_at and $__timeFilter(e.at)""", 15, 43, w=5),
              "A send in the range after that user's first spam report in the range."),
    stat(21, "Failed sends", mail("failed"), 20, 43, w=4),
    ts(22, "Users who bounced or reported spam", """select $__timeGroupAlias(at,'1d'),
  count(distinct user_id) filter (where type = 'bounced') as bounced,
  count(distinct user_id) filter (where type = 'complained') as spam
from analytics.email_events
where type in ('bounced', 'complained') and $__timeFilter(at)
group by 1 order by 1""", 0, 47, 24, 8),
])

DASHES = {"activation": activation, "opportunity": opportunity, "negotiation": negotiation, "retention": retention, "supply": supply, "email": email, "email-health": health}
out = sys.argv[1]
os.makedirs(out + "/var/lib/grafana-dashboards", exist_ok=True)
for k, d in DASHES.items():
    json.dump(d, open(f"{out}/var/lib/grafana-dashboards/{k}.json", "w"), separators=(",", ":"))

queries = []
for k, d in DASHES.items():
    for p in d["panels"]:
        if not p.get("targets"):
            continue
        queries.append({"d": k, "p": p["title"], "sql": p["targets"][0]["rawSql"]})
rng = "between now() - interval '30 days' and now()"


def expand(sql):
    sql = re.sub(r"\$__timeFilter\((.+?)\)(?=\s|$|\))", lambda m: f"({m.group(1)} {rng})", sql)
    sql = re.sub(r"\$__timeGroupAlias\((\w+),'1d'\)", r"date_trunc('day', \1) as time", sql)
    return sql


json.dump([{**q, "sql": expand(q["sql"])} for q in queries], open(out + "/queries.json", "w"), indent=1)
