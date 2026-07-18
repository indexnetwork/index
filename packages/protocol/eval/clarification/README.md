# Clarification taxonomy eval

Focused exact-match corpus for the IntentClarifier's canonical QUD underspecification taxonomy.

From `packages/protocol`:

```bash
bun run eval:clarification
```

The runner invokes the live `IntentClarifier` for cases covering `missing_constituent`, `missing_constraint`, `open_alternative_set`, and a sufficiently specific `null` case. A case passes only when the emitted type exactly equals the fixture expectation, the clarification decision agrees with that type, and the output is not the model-error fallback.
