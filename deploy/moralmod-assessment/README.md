# MoralMod assessment service on Railway

The assessment service is the Sydney Levine Lab's decision service (their
`decision-studio` repo: Python, Postgres + Procrastinate, separately operated
API and worker processes), deployed in our infrastructure and scaled for the
village's ON-arm turn volume. Index talks to it through the draft
`moralmod-consult-0` contract (`packages/moralmod/src/consult.ts`):

```
POST {base}/runs {key, packet, owner_user_id}   -> 202 {run_id}
GET  {base}/runs/{run_id}                       -> {status: running|ready|unavailable, result?}
```

Until the lab's service exposes exactly this, a thin adapter sidecar maps it
onto their workflow start/wait endpoints. The contract is pinned in one module
on our side and adapts when the lab's integration memo lands.

## Railway project layout

One Railway project, three services plus Postgres:

| Service | Image / source | Role |
|---|---|---|
| `assessment-api` | `ghcr.io/sydney-levine-lab/decision-studio@<PIN>` (lab-pushed; ask the lab for the validated pin — their deployment README lists three native revs, only one is the study's) | admission + run state API |
| `assessment-worker` | same image, worker command | the 13–32 LLM calls per assessment |
| `assessment-maintenance` | same image, `--maintenance` | stalled runs, deadlines, provider cooldowns, research-event outbox (pending lab answer on whether we run their outbox or emit from our hook) |
| Postgres | Railway Postgres plugin | run/case state, Procrastinate queue |

`railway.template.toml` carries the per-service settings to copy into each
service's config; `.env.example` lists every variable.

## Sizing

Design targets ~5k ON turns/day, ~20/min peak, p95 assessment 2 min:

- Peak concurrent assessments ≈ 20/min x 2 min = 40 → start the worker fleet
  at **48 concurrent runs** (e.g. 6 replicas x 8 tasks) and measure.
- Provider volume ≈ 65k–160k LLM calls/day on the lab's keys. Their key tier
  is the likeliest real ceiling — ask the lab for **dedicated keys** so their
  remaining hosted cohort is isolated from our volume.
- The Index-side consult deadline is `MORALMOD_CONSULT_DEADLINE_MS`
  (default 150s): a run that cannot answer in time becomes a plain
  (fallback) turn, so queue saturation degrades gracefully and never blocks
  the village.

## Wiring Index to it

On the Index API / hosted-agents services (also on Railway):

```
MORALMOD_ASSESSMENT_URL=https://<assessment-api>.railway.internal
MORALMOD_ASSESSMENT_TOKEN=<shared bearer>
MORALMOD_CP_TOKEN=<bearer the lab cp presents on /integrations/moralmod/*>
MORALMOD_RELAY_URL=<Village Data relay, when the lab wants hook-side emission>
MORALMOD_RELAY_TOKEN=<relay bearer>
MORALMOD_MAX_CONCURRENT_CONSULTS=8        # per hosted-agents replica
MORALMOD_CONSULT_DEADLINE_MS=150000
MORALMOD_TEMPLATE_ID=aggregate-value-mean-hold-v1
```

Unset `MORALMOD_ASSESSMENT_URL` and the hosted agent runs exactly as before;
unset `MORALMOD_CP_TOKEN` and the integration endpoints answer 404.

## Ramp gates (from the design doc)

Stage 0 shadow → 5-box cohort → 50 residents → full ON arm. Hold between
stages unless: assessment p95 ≤ 2.5 min; fallback rate ≤ the lab's threshold;
post-consult submit-failure rate ≈ OFF-arm baseline; zero publication-guard
leaks; exposure events ≈ ON turns.

## Open items blocking first deploy

1. Lab-pushed image + the validated pin (or BuildKit token flow to build from
   source against their private `flexible-moral-reasoning` pin).
2. Dedicated `OPENROUTER_API_KEY` / `OPENAI_API_KEY` / `TYPESAFE_API_KEY`.
3. Lab answers on: consult contract without stage/proof plumbing, bound vs
   unbound policy mode, exposure outbox vs hook emission, per-resident
   identity (JWKS), shadow-run marking. See the design doc's Open questions.
