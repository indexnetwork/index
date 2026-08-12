# IND-638B validation receipt addendum: provider-free eval CLI CI

Date: 2026-08-11
PR: `#1365`

## Addendum boundary

This addendum validates immutable post-receipt implementation head:

- implementation head: `8772893f46a2b387aea852f8b6b0bca448c381da`;
- reviewed base and merge-base: `88c8e9d881047fef965e60061fe130e64242c94e`;
- binary branch diff SHA-256: `effc1d910a30a33ee381a1ca18bbad5afcfa26a84cbd8248e46aaab0b75235fd`;
- branch diff: 72 files, 19,060 insertions, 277 deletions.

It supplements `2026-08-11-ind-638b-validation-receipt.md`, which validates pre-receipt implementation head `7fa3eb12e43d47c7dd018ea4b4954044a1b6e7d3`. This addendum is committed after `8772893f4` and does not validate itself. Neither receipt authorizes merge.

## Hosted-check failure and fix

The first PR check set passed every job except `eval-cli-tests`. Its credential-stripped, all-CLI-spec process exposed two gaps not reproduced by repository-local env loading:

1. importing `EmbedderAdapter` also constructed its exported singleton's OpenAI client, so module import failed when `OPENAI_API_KEY` and `OPENROUTER_API_KEY` were absent;
2. the merged-PR-A ancestry audit ran `git merge-base --is-ancestor`, but the job used the default shallow checkout and Git returned exit 128.

Commit `8772893f4` fixes both without widening historical-quality runtime authority:

- `EmbedderAdapter` retains immutable identity at construction but creates its OpenAI client lazily on first generation;
- missing or blank `OPENROUTER_API_KEY` now fails before client construction or network access with a sanitized error;
- supplied API key, custom base URL, default OpenRouter headers, and one-client reuse semantics are preserved;
- an isolated provider-free lifecycle test is registered in the repository's isolated-test inventory;
- only the `eval-cli-tests` checkout receives `fetch-depth: 0`;
- the quality contract audit pins that job-scoped full-history requirement.

Independent review of `8772893f4` returned zero Critical, Important, or Minor findings and verdict **READY**.

## Exact-head validation

At `8772893f46a2b387aea852f8b6b0bca448c381da`:

- API/protocol build passed;
- the exact credential-stripped CLI job reproduction, run from an empty temporary cwd after the protocol build, completed **759 pass, 12 guarded DB skips, 0 fail** across 28 files;
- the isolated provider-free embedder lifecycle completed **4 pass, 0 fail**;
- the quality contract audit completed 9/9, including PR-A ancestry and job-scoped `fetch-depth: 0` checks;
- API CLI-spec typecheck passed;
- API lint completed with zero errors and 45 existing warnings;
- isolated-test inventory validated 116 registered files with no missing or unregistered entries;
- `git diff --check` and clean worktree/index checks passed.

The exact disposable side-A proof and guarded integration suite were also repeated at this implementation head: **17 pass, 0 fail**. Provider and Redis credentials were absent from the guarded child environment; embedding/model seams remained mocked, and the base was accessed through its read-only endpoint.

The earlier complete provider-free matrix at `7fa3eb12e` remains the authority for unchanged protocol, Eval Ops, architecture, generation, atlas, parity, skills, and `eval:verify` surfaces. The affected API, workflow, isolated-test inventory, and DB gates were freshly rerun at `8772893f4` as recorded above.

## Additional diagnostic disclosure

While developing the provider-free lifecycle test, an initial global-fetch stub did not intercept the OpenAI SDK's captured fetch. It produced one unauthenticated OpenRouter HTTP 401 and one failed custom-host connection. No model inference, embedding result, database operation, Neon mutation, Redis operation, or artifact was produced. The final test uses an isolated module mock and makes no provider request.

## Remaining boundary

Live legacy smoke, intent smoke, enrichment smoke, and the ten-slot pilot remain separately authorized post-merge rollout stages. PR updates, hosted checks, review, and this addendum do not authorize merge or rollout.
