# Unified Sync System

This repository includes a shared, idempotent sync framework for Links (web crawl), Notion, Gmail, Slack (and room for more). All providers use the same engine and expose two triggers: an async HTTP API and a CLI suited for CronJobs.

## How It Works
- Queue: in‑process queue with concurrency (`SYNC_CONCURRENCY`, default 2).
- Run store: DB‑backed by default (table `sync_runs`), in‑memory fallback. Set `SYNC_USE_DB_STORE=0` to disable.
- Progress: poll `GET /api/sync/runs/:runId` or subscribe to SSE at `GET /api/sync/runs/:runId/events`.
- Idempotency: dedupe by existing intent payloads; providers use delta sync via cursors (`provider_cursors`) and per‑integration `lastSyncAt`.

## HTTP API
- Enqueue immediate sync
  - POST `/api/sync/now` body: `{ "provider": "links|notion|gmail|slack", "params": { "indexId?": "<uuid>" } }`
  - Response: `202 { runId }`
- Links (shortcut): `POST /api/indexes/:indexId/links/sync` → `202 { runId, status: "queued", links, filesImported: 0, intentsGenerated: 0 }`
- Run status: `GET /api/sync/runs/:runId`
- SSE stream: `GET /api/sync/runs/:runId/events`

## CLI
- `cd protocol && SYNC_USER_ID=<userId> yarn sync-all links --index <indexId> --wait`
- Other providers: `yarn sync-all notion|gmail|slack --index <indexId> [--wait]`

## Environment
- `SYNC_USE_DB_STORE=1` (default) — persist runs.
- `SYNC_CONCURRENCY=2` — max concurrent jobs.
- For Links crawling: `CRAWL4AI_*` variables.
- Composio: `COMPOSIO_API_KEY` and provider connections.

## Kubernetes CronJob Examples

Links (every 30m)
```yaml
apiVersion: batch/v1
kind: CronJob
metadata:
  name: sync-links
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
                - { name: SYNC_USE_DB_STORE, value: "1" }
                - { name: DATABASE_URL, valueFrom: { secretKeyRef: { name: db, key: url } } }
```

Notion (hourly)
```yaml
apiVersion: batch/v1
kind: CronJob
metadata:
  name: sync-notion
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
metadata:
  name: sync-gmail
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

Notes
- The Links provider skips unchanged pages via content hash; Notion/Gmail/Slack use time‑based cursors in `provider_cursors`.
- Prefer SSE for progress in the web UI; fall back to polling if the network blocks EventSource.
