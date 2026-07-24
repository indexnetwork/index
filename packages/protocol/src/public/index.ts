/**
 * public — IND-543 outer shell.
 *
 * Curated root assembly and temporary compatibility aliases.  This shell will
 * eventually host a structured sub-barrel that feeds src/index.ts; during
 * the outer-seam phase (IND-543) it establishes the boundary and naming
 * convention without duplicating the existing root barrel.
 *
 * Boundary: public-compatibility.  May only reference capability contracts
 * via capabilities/*.facade.ts — never capability implementation internals.
 * Must not introduce a second supported package entry point; src/index.ts
 * remains the sole supported entry.
 *
 * Shell is intentionally declaration-only at this phase.  Curated re-exports
 * follow in subsequent issues once public/ is wired into src/index.ts.
 */
