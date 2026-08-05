/**
 * zod's entry point, with the one export `bun --bun vitest` drops put back.
 *
 * zod 3.25's index.js says `import * as z from "./v3/external.js"; export { z }`.
 * Re-exporting a namespace import is handled by node's vitest and by plain
 * `bun`, but not by the module runner this app's `bun --bun vitest run` uses:
 * `import { z } from "zod"` arrives `undefined` there, so any protocol module
 * built on zod schemas throws on load. Aliased in vitest.config.ts only; the
 * shipped bundle imports no zod and is untouched.
 *
 * `zod/v3` is the same code reached by a subpath the alias does not rewrite, and
 * its flat exports (`string`, `object`, `ZodIssueCode`, …) are ordinary star
 * re-exports, which the runner does keep. Rebuilding the namespace from them
 * gives back exactly what `zod` publishes as `z`.
 *
 * The star re-export below matters as much as `z` does: zod's entry publishes
 * every one of those flat names too (`export * from "./v3/external.js"`), so a
 * module reachable from these tests that does `import { ZodError } from "zod"`
 * would otherwise receive `undefined` and fail somewhere unrelated to the reason.
 * Standing in for a module means standing in for all of it, not for the one
 * binding that happened to be needed first.
 *
 * What this shim cannot check for itself: it names `zod/v3` while the app
 * depends on `zod`, so a bump of that dependency to zod 4 would leave the tests
 * validating fixtures against a different library from the one the server runs —
 * the one way this workaround could green the suite dishonestly. tests/zod-shim.test.ts
 * asserts the two are still the same module instance, so that divergence fails a
 * test rather than passing quietly.
 */
import * as zodV3 from 'zod/v3';

export * from 'zod/v3';

export const z = zodV3;
export default zodV3;
