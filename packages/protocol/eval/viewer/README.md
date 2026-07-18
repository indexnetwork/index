# Privacy-aware eval artifact viewer

`eval:view` generates a deterministic, self-contained HTML inspection artifact from a
validated eval JSON artifact. It is provider-free, public/redacted by design, and
read-only: it never rewrites an input, changes a baseline or gate, records a judgment,
or calls a model.

```bash
cd packages/protocol
bun run eval:view -- \
  --input eval/matching/baselines/matching.baseline.json \
  --out /tmp/matching.viewer.html

# Optional, explicit baseline comparison for a compatible shared run report
bun run eval:view -- \
  --input eval/matching/runs/example.json \
  --baseline eval/matching/baselines/matching.baseline.json \
  --out /tmp/matching-run.viewer.html
```

Use `--force` to replace an existing **output**. It never permits the output to collide
with `--input` or `--baseline`. Unknown, duplicate, positional, and missing-value
arguments are rejected. Successful rendering exits 0 regardless of the artifact's eval
result; malformed, prohibited, unsupported, or incompatible artifacts produce a visibly
safe failure page and exit 2. Preflight or output-I/O failures exit 1.

## Supported adapters

The registry is explicit. The viewer never recursively renders arbitrary JSON and never
selects fields by guessing.

| Artifact | Required identity | Public projection |
| :-- | :-- | :-- |
| Shared baseline/run report | `index-eval/baseline` or `index-eval/run-report`; schema `1` or `2`; harness version `1`; harness `matching`, `profile`, `premise`, or `opportunity` | Envelope provenance/completeness, aggregate and rule rates, case state, allowlisted scored assertions, and — for v2 only — structural requested-run/attempt evidence |
| HyDE blind public batch | `hyde-blind-public-batch`; current strict HyDE public schema and valid batch fingerprint | Public study/fingerprint metadata plus opaque id, task kind, rubric, source text, and judged item text |

A baseline comparison requires a full-corpus `index-eval/run-report` plus an
`index-eval/baseline` for the same registered shared harness/version and a compatible
known current corpus fingerprint. Legacy-migration baselines state that their corpus
fingerprint is unavailable, so compatibility cannot be proven and every such comparison
is visibly labeled descriptive and unverified. A current run report with an unavailable
fingerprint is rejected. Even for a known corpus match, deltas are descriptive: the viewer
does not assert model, judge, configuration, or statistical-gate equivalence. It reports
aggregate, rule, and case rate deltas plus new/missing cases where comparison is allowed.
A baseline is not accepted for a filtered run, another baseline, an incomplete v2 report,
or a HyDE public batch.

Shared schema v1 records scored runs, not execution attempts. The viewer therefore says
explicitly that retry/attempt telemetry was not recorded and never fabricates it. Shared
schema v2 displays genuine execution policy and completeness plus requested run/attempt
IDs, outcomes, recovered state, timestamps, duration, retryability, and backoff. Incomplete
v2 reports remain inspectable, including zero-output cases, but cannot be compared with a
baseline. Scored diagnostics retain the requested slot number from `scoredRunIds` rather
than being renumbered after failed slots.

## Public/redacted boundary

Public/redacted mode is the only mode. There is no unsafe, private, raw-JSON, or
unblinding switch. Shared case payloads are passthrough at the storage schema boundary,
so every harness adapter uses its own positive allowlist. It omits, among other fields:

- raw model/evaluator reasoning and assertion details;
- candidate identifiers and arbitrary harness-specific payload fields;
- profile/person details and PII findings;
- generated premises/cards and leakage diagnostics;
- secrets, credentials, request headers, embeddings, and mappings;
- v2 provider error class/code/message, even though persistence sanitizes them;
- every adapter-declared sensitive field.

Only `hyde-blind-public-batch` is accepted from the HyDE artifact family. The registry
explicitly rejects collection artifacts, private keys, independent judgments, resolver
decisions, resolved adjudication, analysis artifacts, and current or future artifact
types that indicate private, mapping, key, unblinding, judgment, resolution, collection,
or adjudication material. Rejection pages never echo source values.

When adding an adapter:

1. Register an exact artifact type, schema version, harness, and harness version.
2. Parse with the artifact owner's strict parser.
3. Project a small `ViewerDocument` allowlist; never retain a source object reference.
4. Declare sensitive source fields and add seeded non-disclosure tests.
5. Reject unknown diagnostic kinds until they receive an explicit privacy review.
6. Add malformed/incompatible, deterministic-output, and source-integrity coverage.

## Offline and read-only guarantees

The HTML contains only inline CSS, inline JavaScript, and the projected public data. Its
Content Security Policy disables connections, images, fonts, objects, frames, base URLs,
and form actions. The script has no fetch, XHR, WebSocket, beacon, import, analytics,
upload, or runtime-network path. Artifact strings are embedded with script-safe JSON and
rendered with DOM text nodes rather than raw HTML.

The client supports search, group/rule and state filters, baseline-delta filters,
pagination, previous/next/random item navigation, keyboard controls, semantic landmarks,
visible focus, live result counts, and reduced-motion preferences. It has no editable
judgment, save, upload, or baseline-update control.

The CLI hashes and snapshots exact input bytes, reads them without opening a write handle,
resolves symlink aliases while retaining the canonical destination, and publishes HTML
through a collision-resistant same-directory temporary file. A no-force publish uses an
atomic no-clobber link; force replacement uses an atomic rename. Tests hash inputs before
and after both successful and safe-failure rendering and cover lexical plus symlink-aliased
input/output collisions.

## Verification

```bash
cd packages/protocol
bunx tsc --noEmit -p eval/viewer/tsconfig.json
bun test --timeout 30000 eval/viewer/tests/
bun run eval:verify
```
