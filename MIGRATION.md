# Migrating to `@indexnetwork/a2a`

This package was renamed from `@indexnetwork/negotiator` to
`@indexnetwork/a2a`, and its two entry points swapped places: the A2A client
and server moved to the package root, and the LLM decision engine moved to a
`/negotiator` subpath.

Nothing in the API changed — no type, function, or option was renamed. The
domain vocabulary (`Negotiator`, `NegotiationDecision`, `NegotiationTerms`,
`A2ANegotiationClient`, `verifyAgreement`) is unchanged and stays that way.
This is a package-name and import-path migration only.

## What changed

| Before | After |
| --- | --- |
| `@indexnetwork/negotiator` | `@indexnetwork/a2a/negotiator` |
| `@indexnetwork/negotiator/a2a` | `@indexnetwork/a2a` |
| `negotiator` (bin) | `index-a2a` (bin) |

Note the crossover: the two paths swap. A blanket find-and-replace of
`@indexnetwork/negotiator` will silently break the `/a2a` imports by turning
them into `@indexnetwork/a2a/negotiator/a2a`. Replace the longer path first.

## Migrating a consumer (e.g. `../agent`)

### 1. The dependency

The repository directory is still `negotiator/`, so a `file:` dependency
keeps its path for now:

```json
"dependencies": {
  "@indexnetwork/a2a": "file:../negotiator"
}
```

If the directory is later renamed to `a2a/`, that path becomes
`file:../a2a` and every consumer has to move in the same commit — the
directory rename and the `file:` path are one change, not two.

Then re-link:

```bash
bun install
```

### 2. The imports

Run these in order — longest path first, so the crossover doesn't collapse:

```bash
# 1. the A2A layer: subpath -> package root
grep -rl '@indexnetwork/negotiator/a2a' src \
  | xargs sed -i '' 's|@indexnetwork/negotiator/a2a|@indexnetwork/a2a|g'

# 2. the decision engine: package root -> subpath
grep -rl '@indexnetwork/negotiator' src \
  | xargs sed -i '' 's|@indexnetwork/negotiator|@indexnetwork/a2a/negotiator|g'
```

(`sed -i ''` is the macOS/BSD form; on GNU sed use plain `sed -i`.)

In `../agent` as of this writing that is 16 lines across 7 files:

- `src/index.ts` — re-exports from both entry points, plus two prose comments
- `src/core/agent.ts` — both entry points
- `src/core/types.ts` — both entry points
- `src/core/fanout.test.ts` — the negotiator entry point
- `src/core/agent.test.ts` — both entry points
- `src/core/digest.ts` — the negotiator entry point
- `src/core/model.ts` — a prose comment about `OpenRouterClient`

The `sed` pass covers the comments too. One of them wants a second look
afterwards: `src/index.ts:4` reads "negotiates over A2A, one turn at a time,
via @indexnetwork/negotiator" — that sentence is about the wire, so it
should end up as `@indexnetwork/a2a`, not the `/negotiator` subpath the
`sed` will give it. The rest read correctly either way.

### 3. The package description

`../agent/package.json` describes itself as negotiating "over A2A via
@indexnetwork/negotiator". Update that string by hand; the `sed` pass above
only touches `src/`.

### 4. Verify

```bash
bun run typecheck && bun test
```

Typecheck is the real check here: every import from this package resolves to
a type or a value that TypeScript will fail on if a path is wrong, and the
crossover mistake (`@indexnetwork/a2a/negotiator/a2a`) fails as an
unresolved module rather than silently.

## Why the entry points swapped

The A2A layer is the integration point — it is what another agent talks to,
and what a consumer installs this package for. The negotiator is the engine
behind it. Under the old name the root export was the engine and the
integration point was a subpath, which had it backwards.

The layers are only type-coupled (every `a2a → core` import is `import type`
except the shared deadline helper), so the split itself is unchanged; only
which one answers to the bare package name moved.
