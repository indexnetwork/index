# Unified Sync System (current)

One engine powers sync for Links (web crawl), Notion, Gmail, Slack, Discord, Calendar. It exposes two triggers: an async HTTP API and a Cron‑friendly CLI. The engine is idempotent (dedupes intent payloads), rate‑limited, and observable (runs + progress).

## Overview

- Queue + Concurrency: in‑process queue (`SYNC_CONCURRENCY`, default 2).
- Run Store: DB by default (`sync_runs`); set `SYNC_USE_DB_STORE=0` to use in‑memory for dev.
- Progress: poll `GET /api/sync/runs/:runId` or stream SSE `GET /api/sync/runs/:runId/events`.
- Cursors: `provider_cursors` stores per‑provider checkpoints (time‑based `lastSyncAt` for now; upgradeable to native tokens).
- Idempotency: no duplicate intents for the same payload within an index.

## HTTP API

- Enqueue: `POST /api/sync/now`
  - Body: `{ "provider": "links|notion|gmail|slack|discord|calendar", "params": { "indexId?": "<uuid>" } }`
  - Response: `202 { runId }`
- Links shortcut: `POST /api/indexes/:indexId/links/sync?all=true|false&skipBrokers=true|false`
  - Default (no `all`): processes only links that have never been synced (lastSyncAt is null).
  - `all=true`: processes every link in the index.
  - Response: `202 { runId, status: "queued", links, filesImported: 0, intentsGenerated: 0 }`
- Run status: `GET /api/sync/runs/:runId`
- SSE (optional): `GET /api/sync/runs/:runId/events`

## CLI (Cron‑friendly)

- Usage: `yarn sync-all <provider> [options]`
- Help: `yarn sync-all --help`
- Examples
  - `SYNC_USER_ID=<userId> yarn sync-all links --index <indexId> --wait`
  - `yarn sync-all notion --index <indexId> --user <userId>`

## Links Behavior (what gets synced)

- Default “Sync now”: only links that have never been synced are processed.
- “Sync all”: include `?all=true` (or use the UI button) to process all links.
- Dedupe: if a generated intent payload already exists for the index, it is not re‑inserted.

## Environment

- `SYNC_USE_DB_STORE=1` (default) — persist runs in DB.
- `SYNC_CONCURRENCY=2` — max concurrent jobs.
- Crawl4AI service: `CRAWL4AI_*` variables.
- Composio for providers: `COMPOSIO_API_KEY` and a connected account per provider.

## Kubernetes CronJob (examples)

Links (every 30m)

```yaml
apiVersion: batch/v1
kind: CronJob
metadata: { name: sync-links }
spec:
  schedule: "*/30 * * * *"
  jobTemplate:
    spec:
      template:
        spec:
          restartPolicy: OnFailure
          containers:
            - name: sync
              image: node:20
              workingDir: /app/protocol
              command: ["yarn","sync-all","links","--index","<INDEX_ID>"]
              env:
                - { name: SYNC_USER_ID, value: "<USER_ID>" }
                - { name: DATABASE_URL, valueFrom: { secretKeyRef: { name: db, key: url } } }
```

Notion (hourly)

```yaml
apiVersion: batch/v1
kind: CronJob
metadata: { name: sync-notion }
spec:
  schedule: "0 * * * *"
  jobTemplate:
    spec:
      template:
        spec:
          restartPolicy: OnFailure
          containers:
            - name: sync
              image: node:20
              workingDir: /app/protocol
              command: ["yarn","sync-all","notion","--index","<INDEX_ID>"]
              env:
                - { name: SYNC_USER_ID, value: "<USER_ID>" }
                - { name: COMPOSIO_API_KEY, valueFrom: { secretKeyRef: { name: composio, key: apiKey } } }
                - { name: DATABASE_URL, valueFrom: { secretKeyRef: { name: db, key: url } } }
```

Gmail (twice daily)

```yaml
apiVersion: batch/v1
kind: CronJob
metadata: { name: sync-gmail }
spec:
  schedule: "0 */12 * * *"
  jobTemplate:
    spec:
      template:
        spec:
          restartPolicy: OnFailure
          containers:
            - name: sync
              image: node:20
              workingDir: /app/protocol
              command: ["yarn","sync-all","gmail","--index","<INDEX_ID>"]
              env:
                - { name: SYNC_USER_ID, value: "<USER_ID>" }
                - { name: COMPOSIO_API_KEY, valueFrom: { secretKeyRef: { name: composio, key: apiKey } } }
                - { name: DATABASE_URL, valueFrom: { secretKeyRef: { name: db, key: url } } }
```

## Thoughts

- Per-item outcomes: write one row per processed item to `sync_run_items` (external_id, status=new|unchanged|error, meta). Expose `GET /api/sync/runs/:runId/items`. UI: small drawer grouped by status.
- Queue backend: consider BullMQ/Redis for multi-instance workers; idempotent job keys; at-least-once semantics with dedupe window.
- Rate limiting/backoff: per-provider dynamic limiter, 429-aware backoff, circuit-breakers, quotas per user/index.
- Observability: counters (runs started/completed, error rate), latency histograms, trace spans keyed by `runId`; structured logs (provider, userId, runId).
- Security/auth: tokenized SSE (query param) or cookie-based auth; enforce run ownership in all run/item endpoints; PII scrubbing in logs.
- CLI ergonomics: flags like `--all` (links), `--since <ts>`, `--reset-cursor`, machine-readable logs, stable exit codes; `--json` output.
- Data model hygiene: unique(run_id, external_id) on `sync_run_items`; consider dropping `last_content_hash` if it remains unused.
- Testing: provider stubs, contract tests for handlers, queue transition tests, and smoke tests with mocked Crawl4AI/Composio.
