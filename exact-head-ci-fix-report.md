# PR #1369 exact-head CI fix report

## Root causes from authoritative public logs

- Run `31631260311`, job `94230324707`: Universal compilation completed, then compiled-identity extraction passed an empty string to Python. Current Apple `otool -X` emitted 16-hex-digit fields while the parser accepted exactly 8, causing `json.loads('')` after 91 seconds.
- Run `31631260311`, job `94230324682`: the macOS release fixture suite used `/var/folders/...` from `TMPDIR`; strict physical-path validation resolved that to `/private/var/folders/...` and rejected the alias before the intended fixture assertions.
- Run `31631260310`, job `94230324760`: the rollback job derived a mutable merge-base, compared it with a stale `b363...` pin, and failed without output. The approved rollback authority in the task/report is immutable `751f5a7ed143150488543db9a1b4ee1f1b833bfc`.
- Run `31631260297`, eval-verify: setup-bun exhausted retries on `socket hang up` before install. The workflow used mutable `@v2`/`@v4` action refs.

## Fixes

- Parse all even-width hexadecimal `otool` fields using Python, then decode the embedded JSON; added a realistic 16-digit fixture.
- Emit credential-free Universal stage boundaries and the exact failed stage/exit status.
- Canonicalize `TMPDIR` only for the macOS shell/handoff fixture step, retaining strict production path validation.
- Validate/fetch/archive the immutable approved rollback SHA directly, require it to be an ancestor of the tested merge commit, and always create a fixed-schema non-secret preflight diagnostic before later failure points.
- Pin every lint workflow checkout/setup-bun use to the already reviewed adjacent full SHAs.

No protected, provider, release, or database operation was run locally.
