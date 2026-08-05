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
 */
import * as zodV3 from 'zod/v3';

export const z = zodV3;
export default zodV3;
