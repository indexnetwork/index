# Discovery, and env configuration for every harness

**Status:** approved (four decisions taken 2026-08-05)
**Supersedes:** the discovery-ab naming and the nine-flag offer shipped in IND-628

## 1. Why this exists

Two defects in what shipped, both found by the operator looking at the site.

**The name.** The harness is called `discovery-ab`, so the site reads "Discovery
A/B". But A/B is not part of what it tests — it is how *every* harness can be
run. The suffix describes the mechanism, not the subject.

**The offer.** Discovery offered nine environment flags. Rescanning the
discovery graph's import closure against every env key referenced anywhere in
`packages/protocol` — 61 of them — returns **28**, not nine. The nine were an
artefact of scanning against the inherited 16-key `PROFILE_ENV_ALLOWLIST`: the
catalogue was the limit, not the code. Nineteen real knobs were unreachable from
the site, including `NEGOTIATOR_STANCE`, `NEGOTIATION_SCREEN_MODE`, the
`NEGOTIATION_DEADLOCK_*` pair, `NEGOTIATION_ASK_USER_*` and
`HYDE_FRAME_CONSTRAINTS_ENABLED`.

And the same scan run against the four scorecard harnesses returns **10 keys
each** — `CHAT_MODEL`, `CHAT_REASONING_EFFORT`, `EVAL_MODEL_OVERRIDES`,
`SMARTEST_VERIFIER_MODEL` and the OpenRouter retry/timeout/fallback set. The
earlier claim that these harnesses "do not read env" was true only of the 16
catalogued flags. They read plenty; nobody could set any of it.

## 2. What changes

1. `discovery-ab` becomes `discovery`, everywhere, down to the operational env
   variable names.
2. Every harness gets an environment configuration editor, offering exactly the
   keys reachable from that harness's own code, minus credentials.
3. Discovery no longer forces two sides. A/B is a checkbox there as it is
   elsewhere.
4. Four UI defects fixed.

## 3. The catalogue is derived, not maintained

A hand-maintained list is how the nine happened. The offer must come from the
code.

`HARNESS_ENV_KEYS` is **generated** by walking each harness entry point's
transitive import closure and collecting `process.env.KEY` reads, using the
scanner already written for IND-628 (`reachableEnvKeys`, Bun.Transpiler comment
stripping). The generated module is committed, dependency-free, and importable
by the browser bundle — the same constraints `ops.allowlist.ts` documents.

A spec test regenerates the catalogue and fails on any difference. So the
committed file cannot drift from the code, and a flag added to the graph
tomorrow shows up on the site without anyone remembering to add it.

**Entry points are the harness's own, not a shared root.** Scanning a barrel
would hand every harness every key and reintroduce the inert-flag lie in a new
costume.

### Credentials are excluded at generation and refused at the boundary

`ENV_SECRET_KEYS` = `OPENROUTER_API_KEY`, `OPENROUTER_BASE_URL`,
`DISCOVERY_TARGETS`. The first two are reachable from every harness and must
never be settable from a browser: one repoints the run at another provider
account, the other at another endpoint. The third is read by the discovery
engine's bootstrap rather than by a harness closure, and carries `protocol_eval`
connection strings with passwords.

**One predicate, `isCredentialEnvKey`, called at two sites**: the generator, so
such a key never enters a catalogue, and `validateConfigOverrides`, so one is
refused at the request boundary even if a generator bug published it. Two call
sites, not two independent definitions — a second definition is how the form and
the server come to disagree about what a credential is.

The predicate is a name list *plus* a shape rule (`_KEY`, `_TOKEN`, `_SECRET`,
`_URL` and friends, matched anywhere in the name, with an explicit exception
list). **Neither guard subsumes the other**, and a test pins exactly which keys
each one catches:

- The shape rule alone covers `OPENROUTER_API_KEY` and `OPENROUTER_BASE_URL`, so
  a rename that escaped it would fail that test.
- It does **not** cover `DISCOVERY_TARGETS`, whose name says what it points at
  rather than what it is. The list is that key's only guard.

The second case is why the list is not decoration: a secret can be named after
its subject, and "named the way secrets are named" is the precise limit of what
the shape rule promises.

Measured against the 64-key candidate universe, the predicate matches ten keys
and **zero** of the 27 any harness offers — which is why the exception list is
empty. Tested from both directions.

## 4. Every offered key must be explainable

A key with no metadata renders as a bare `SCREAMING_SNAKE` string with no
description, no input affordance and no validation — which is how
`DISCOVERY_PROFILE_SOURCE=user-context` silently ran `premise` on both sides of
an A/B and reported a difference that did not exist.

So: **offered ⊆ documented**, enforced by test. Every key in `HARNESS_ENV_KEYS`
has an `ENV_FLAG_METADATA` entry whose `kind`, `values` and `min` mirror the
flag's own **read site**, not `startup.env.ts`'s declaration. Where the two
disagree the read site wins, for the reason `envFlagValueIssue` already
documents: an unrecognised value does not fail, it falls back.

If a new flag appears in the closure and nobody has written its metadata, the
drift test fails and the flag is not offered until someone explains it. That is
the intended pressure.

## 5. Discovery without sides

A/B becomes optional. Single run: one env configuration, one branch reset, one
child, one scorecard. Comparison: unchanged.

The engine gains `--env KEY=VALUE` for the single case, alongside the existing
`--a`/`--b`. Exactly one of {`--env`} or {`--a` and `--b`} may appear; the
existing symmetric-keys and at-least-one-difference rules continue to apply to
the pair, and are meaningless for a single run.

Exit codes keep their meanings, with one narrowing: exit 4 says "branches were
reset and a side was spawned"; for a single run it is one branch and one child.
The message must say which, because "both branches were reset" would be false.

## 6. Configs and the harness they run under

A saved config is harness-agnostic; a catalogue is per harness. So a config can
legitimately carry a key the selected harness never reads.

This is **not** refused — the config may be shared with a harness that does read
it. Instead, at launch, keys the chosen harness cannot read are listed as
recorded-but-not-read, naming them. The Configs page annotates each key with the
harnesses that read it.

That closes IND-629 honestly: the overrides stop being silently inert, without
pretending a shared config must fit one harness.

## 7. UI defects

1. **`A · side a` / `B · side b`.** The `A` already says which side it is. Use
   the same `reference` / `candidate` vocabulary as every other harness.
2. **Two `add flag to both sides` buttons.** Keys are symmetric by construction,
   so both buttons did one thing. One control, above the pair.
3. **Native `<select>` for the flag picker.** Renders in system font with an OS
   highlight against a dark monospace UI. Replaced with a themed listbox that
   has room for each flag's description.
4. **Descriptions overflow their column.** Wrap.

## 8. What this deliberately does not do

- **No new harnesses.** The set stays `matching`, `profile`, `premise`,
  `opportunity`, `discovery`.
- **No env editing for credentials**, by any path.
- **No attempt to make scorecard harnesses read product flags.** They read what
  they read; the site now offers exactly that. Making `matching` honour
  `DISCOVERY_ALLOWED_TYPES` would mean routing it through the discovery graph,
  which is what `discovery` is for.
- **No change to the seven flags unreachable from any harness** (IND-630). They
  remain unoffered, and now visibly so: absent from every harness's catalogue
  because no harness reads them.
