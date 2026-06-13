# Memory.md Cron Impact Audit — Did opportunities grow?

**Date:** 2026-06-13
**Question:** We recently added a cronjob for adding intents and premises based on `memory.md`. Did it work? Do we have more opportunities now?
**Data source:** Index Network production Neon DB (`protocol_prod`), via Railway `Index/protocol` `DATABASE_URL`.

## TL;DR

**Yes — opportunities roughly tripled, and the inflection lands exactly on the cron deploy date (June 8).** Premises (the upstream signal the cron writes) grew ~2x and opportunities ~3.2x. The one caveat: **intents did *not* grow** (flat), so the lift is coming from the *premise* side of the cron, not the intent side.

## Before / After (7-day windows around the June 8 deploy)

| Table | Jun 01–07 | Jun 08–14 | Change |
|---|---|---|---|
| Opportunities | 1,313 | 4,150 | **+216% (3.2x)** |
| Premises | 1,629 | 3,410 | **+109% (2.1x)** |
| Intents | 168 | 173 | +3% (flat) |

## Daily trend (the inflection is unmistakable on Jun 8)

| Day | Premises | Opportunities | Pending opps |
|---|---|---|---|
| 06-05 | 23 | 161 | 31 |
| 06-06 | 319 | 92 | 8 |
| 06-07 | 327 | 100 | 11 |
| **06-08** | **800** | **669** | **117** |
| 06-09 | 878 | 844 | 136 |
| 06-10 | 727 | 1,102 | 182 |
| 06-11 | 268 | 690 | 170 |
| 06-12 | 474 | 461 | 106 |
| 06-13 (partial) | 263 | 384 | 84 |

Pre-Jun-8 daily opportunities sat at ~90–350/day; post-deploy they run 400–1,100/day, with daily *pending* (live, actionable) opportunities jumping from ~10–40/day to 80–180/day.

## Deploy correlation

The June 8 step change aligns with the agentvillage cron submodule deploys on dev:
- `dcf39ff85b` — agentvillage submodule → `7b6e679` (Edge-City #79 **cron-fail-closed**) — 2026-06-08
- `182c36026e` / `d7c14a5b94` — submodule → mcp-direct-digest-opportunities — 2026-06-08
- `protocol` service deploys on Railway: 2026-06-08 13:01 / 18:13 / 19:51 UTC

Premise source tracking (`#934 premise source tracking & cascade retraction`) landed Jun 11, so per-source attribution is only fully reliable from then.

## Source attribution (the one nuance)

Premises carry `provenance.source`:
- **explicit** — 5,095 in last 21d. This is the dominant, growing channel (327 → 800 on Jun 7→8). The agent asserting premises from `memory.md` writes them as `explicit` assertions, so this is the channel that grew.
- **integration** — 159 total, all on Jun 12 (a one-day batch, likely a separate connector/backfill, not the daily memory cron).

Intents in the last 21d are **100% `source_type=discovery_form`** — none are tagged to a memory/agent cron channel, consistent with intents staying flat. So the cron is effectively driving **premises → opportunity discovery**, not new intents.

## Current opportunity inventory (all-time, by status)

| Status | Count |
|---|---|
| expired | 2,661 |
| draft | 1,072 |
| **pending** | **962** |
| rejected | 602 |
| accepted | 122 |
| stalled | 61 |
| negotiating | 49 |
| latent | 3 |

## Conclusion & caveats

- **Did it work?** Yes — there is a clean, large, deploy-aligned lift. More premises are flowing in and they are cascading into ~3x more opportunities.
- **Do we have more opportunities now?** Yes — both raw volume and live `pending` opportunities are up materially.
- **Caveat 1 (intents):** The "intents" half of the cron is not visibly producing new intents — intent volume is flat and untagged. Worth checking whether the cron's intent-creation path is actually wired/firing, or whether it only writes premises in practice.
- **Caveat 2 (quality):** A large share of new opportunities land in `expired`/`draft`/`rejected`. The funnel widened, but acceptance (122 all-time) hasn't obviously kept pace — worth a follow-up on conversion, not just volume.
- **Caveat 3 (attribution):** Attribution is by date correlation + source labels, not a hard cron-run join. Source tracking only became reliable Jun 11, so pre-Jun-11 premises can't be split by channel with certainty.

## Suggested next steps

1. Confirm the cron's **intent** path is firing (flat intent volume + `discovery_form`-only source suggests it may not be).
2. Look at **acceptance/conversion** for post-Jun-8 opportunities, not just creation volume.
3. If a dedicated source tag exists for the memory cron, start stamping premises/intents with it so future audits can join directly instead of inferring from dates.
