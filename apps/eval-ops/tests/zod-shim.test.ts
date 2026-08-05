import { describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

// The vitest alias (`/^zod$/`, vitest.config.ts) rewrites this to
// tests/shims/zod.ts, so this is the module every test — and every protocol
// module a test reaches — actually receives for `zod`.
import * as aliased from 'zod';

/**
 * The real `zod` entry, reached by a specifier the `/^zod$/` alias cannot match.
 *
 * Resolved through the package's own `package.json` (which its exports map
 * publishes) rather than a counted-out relative path into node_modules: if the
 * install layout ever changes, this fails as an unresolvable module rather than
 * as a check that quietly stopped checking anything.
 */
async function realZodEntry(): Promise<Record<string, unknown>> {
  const require = createRequire(import.meta.url);
  const packagePath = require.resolve('zod/package.json');
  const entry = new URL('index.js', pathToFileURL(packagePath)).href;
  return (await import(/* @vite-ignore */ entry)) as Record<string, unknown>;
}

describe('the test-only zod shim', () => {
  it('publishes every binding zod does, not only the one that first went missing', () => {
    // `z` is the binding `bun --bun vitest` drops and the reason the shim exists.
    expect(aliased.z).toBeDefined();
    expect(aliased.z.string).toBeTypeOf('function');

    // Everything else zod's entry publishes has to come through too. A protocol
    // module reachable from these tests that does `import { ZodError } from
    // "zod"` gets `undefined` from a shim that re-exports `z` alone, and fails
    // far from the cause.
    expect(aliased.ZodError).toBeTypeOf('function');
    expect(aliased.ZodIssueCode).toBeDefined();
    expect(aliased.string).toBeTypeOf('function');
  });

  it('serves the same module the server runs, so a zod bump cannot pass unnoticed', async () => {
    const real = await realZodEntry();

    // The shim names `zod/v3` by hand while the app's dependency is plain `zod`.
    // Today those are one module: zod 3.25's entry is `export * from
    // "./v3/external.js"` and `zod/v3` re-exports the same file, so every
    // binding is identical by reference. Bump the dependency to zod 4 — or point
    // the shim at another subpath — and they become two different libraries,
    // with these tests validating fixtures against schemas the server never
    // built. Reference identity is what says that has happened.
    expect(aliased.ZodError).toBe(real.ZodError);
    expect(aliased.string).toBe(real.string);
    expect(aliased.z.ZodError).toBe(real.ZodError);
  });
});
