# Discovery retrieval eval

This paired retrieval suite measures LLM/embedding quality over a frozen premise versus
user-context profile corpus. It is not evidence of production database wiring; the API
smoke covers that integration.

## Current registration

The provider-free corpus, scorer, and selection specs are included in `bun run eval:verify`.
That verification command typechecks the suite and runs its tests; it does not execute the
live package script or make provider calls.

The `eval:discovery-retrieval` package script is registered with the same `.env.test`
loading convention as the other live evals, but its runner and CLI entrypoint are pending
Task 2. Do not invoke the script until that entrypoint exists.

## Live commands (after Task 2)

```bash
cd packages/protocol
bun run eval:discovery-retrieval -- --runs 1 --case complementary-role/
bun run eval:discovery-retrieval -- --runs 3 --no-save
bun run eval:discovery-retrieval -- --runs 7 --update-baseline --reason "initial paired profile-retrieval baseline" --force
```
