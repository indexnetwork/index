# moralmod-assessment

The `moralmod-consult-0` service: Index's hosted agent consults it before each
edgecity-goa member's negotiation turn. It wraps the Sydney Levine Lab's
`flexible-moral-reasoning` pipeline (pinned `f17d52c`, used with the lab's
cooperation) behind two endpoints:

```
POST /runs  {key, packet, owner_user_id}  -> 202 {run_id}     (same key joins the same run)
GET  /runs/{run_id}                        -> {status: running|ready|unavailable, result?}
GET  /healthz
```

The `result` is the `DecisionRunResult` shape `@indexnetwork/moralmod`
validates; each action also carries a human-readable `description` so the
negotiator can map scientific options to legal Index actions. Input rendering
follows the lab's own conventions (`input.ts` / `render.py`): a sorted-JSON
vignette, no candidate-action menu — the model infers the scientific actions,
as the lab's production runs do.

## Keys — read this first

Every run needs **both** `OPENROUTER_API_KEY` and `TYPESAFE_API_KEY`: the
pipeline's state and utility stages call the TypeSafe "Jev" model
unconditionally, in both modes. The TypeSafe key comes from the lab. Without
the keys the service stays up and answers `unavailable`, and Index's hook
falls back to the plain negotiator — the village never blocks on this service.

## Modes

- `mutual_benefit` (default): no moral-rules stage, so no severity
  calibration is needed; `severity` is all zeros and `value` equals
  `welfare`. ~22s/run at `REASONING_EFFORT=none`.
- `full`: `MSAModule` with rules. Needs a populated severity cache
  (`SEVERITY_CACHE_DIR`) for the exact model/effort pair — the lab ships one
  for `openai/gpt-5.6-luna` at `default` effort (600 LLM calls to rebuild).

## Railway

One service from this directory's Dockerfile:

1. New service → deploy from repo, root `services/moralmod-assessment`.
2. Build secret `github_token`: a read-scoped token for
   `Sydney-Levine-Lab/flexible-moral-reasoning` (the pipeline is a private
   git dependency).
3. Variables: everything in `.env.example`.
4. Point Index at it: on the **hosted-agents** service set
   `MORALMOD_ASSESSMENT_URL=http://<this-service>.railway.internal:8080`
   (Railway private networking is plain HTTP with the explicit port) and
   `MORALMOD_ASSESSMENT_TOKEN=<ASSESSMENT_API_TOKEN>`. The scope is
   `MORALMOD_NETWORK_KEY` (default `edgecity-goa`).

Sizing: single instance, `MAX_CONCURRENT_RUNS=4` to start. Index's consult
deadline (default 150s) bounds queueing — an overloaded service produces
plain turns, not stuck ones. Scale `MAX_CONCURRENT_RUNS`/replicas from the
fallback rate; replicas need a shared run store (deliberately not built yet).

## Local

```sh
uv venv && uv pip install -e .            # or install the pipeline from a local checkout, see pyproject
ASSESSMENT_API_TOKEN=dev uv run uvicorn app.main:app --port 8080
```
