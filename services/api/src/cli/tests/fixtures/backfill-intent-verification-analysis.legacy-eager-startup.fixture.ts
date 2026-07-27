/**
 * Minimal executable reproduction of the retired startup behavior. Before the
 * fix, createRuntimeDeps eagerly did this exact construction before dry-run
 * reporting; without a provider key it fails before any report can be emitted.
 */
import { SemanticVerifier } from '@indexnetwork/protocol';

new SemanticVerifier();
process.stdout.write('unreachable\n');
