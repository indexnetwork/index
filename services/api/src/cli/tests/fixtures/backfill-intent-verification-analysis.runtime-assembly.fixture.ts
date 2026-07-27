/**
 * Exercises the production createRuntimeDeps path under a local, unreachable
 * database URL and no provider configuration. Assembly must remain lazy: no
 * database module/client or verifier/provider is constructed until a method is
 * actually called by a command run.
 */
import { createRuntimeDeps } from '../../backfill-intent-verification-analysis';

await createRuntimeDeps({ dryRun: true });
process.stdout.write('{"assembled":true}\n');
