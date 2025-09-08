# Sync (current)

One engine powers sync for Links (web crawl), Notion, Gmail, Slack, Discord, Calendar. It exposes:
- A synchronous, Cron‑friendly CLI
- An HTTP endpoint that only acknowledges requests (async is orchestrated by Kubernetes)

## Overview

- Synchronous CLI: runs provider to completion and exits with success/failure.
- API is ack‑only: returns 202; background execution is external.
- Cursoring: providers rely on `user_integrations.last_sync_at`.
- Idempotency: no duplicate intents for the same payload within an index.

## HTTP API

- Ack: `POST /api/sync/now`
  - Body: `{ "provider": "links|notion|gmail|slack|discord|calendar", "params": { "indexId?": "<uuid>" } }`
  - Response: `202 { accepted: true }`
- Links shortcut: `POST /api/indexes/:indexId/links/sync?all=true|false&skipBrokers=true|false`
  - Default (no `all`): processes only links that have never been synced (lastSyncAt is null).
  - `all=true`: processes every link in the index.
  - Response: `202 { success: true, accepted: true }`
  - Response: `202 { success: true, accepted: true }`

## CLI (Cron‑friendly)

- Usage: `yarn sync-all <provider> [options]`
- Help: `yarn sync-all --help`
- Examples
  - `SYNC_USER_ID=<userId> yarn sync-all links --index <indexId>`
  - `yarn sync-all notion --index <indexId> --user <userId>`

## Links Behavior (what gets synced)

- Default “Sync now”: only links that have never been synced are processed.
- “Sync all”: include `?all=true` (or use the UI button) to process all links.
- Dedupe: if a generated intent payload already exists for the index, it is not re‑inserted.

## Environment

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

- Keep CLI simple and synchronous; use CronJobs to run providers periodically.
