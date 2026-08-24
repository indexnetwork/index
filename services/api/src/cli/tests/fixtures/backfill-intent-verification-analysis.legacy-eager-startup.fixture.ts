/**
 * Minimal executable reproduction of the retired startup behavior. Before the
 * fix, createRuntimeDeps eagerly did this exact construction before dry-run
 * reporting; without a provider key it fails before any report can be emitted.
 *
 * `new Intents()` alone no longer constructs a model — the capability builds its
 * collaborators on first use — so the eager step is the first verifier call.
 */
import { Intents } from '@indexnetwork/protocol';

await new Intents().verifyIntent('probe', '{}');
process.stdout.write('unreachable\n');
