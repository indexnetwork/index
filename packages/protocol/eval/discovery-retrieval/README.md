# Discovery retrieval eval

This paired retrieval suite measures LLM/embedding quality over a frozen premise versus
user-context profile corpus. It is not evidence of production database wiring; the API
smoke covers that integration.

## Availability

The provider-free corpus, scorer, selection specs, runner, and CLI are available. `bun run
eval:verify` typechecks the suite and runs its provider-free tests; it does not execute the
live package script or make provider calls.

The `eval:discovery-retrieval` package script uses the same `.env.test` loading convention
as the other live evals.

## Live commands

```bash
cd packages/protocol
bun run eval:discovery-retrieval -- --runs 1 --case complementary-role/
bun run eval:discovery-retrieval -- --runs 3 --no-save
bun run eval:discovery-retrieval -- --runs 7 --update-baseline --reason "initial paired profile-retrieval baseline" --force
```
