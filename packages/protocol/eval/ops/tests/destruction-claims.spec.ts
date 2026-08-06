/**
 * Every sentence that tells an operator what a discovery run DESTROYS.
 *
 * These are the highest-consequence claims in the documentation: someone reads
 * one to decide whether a run is safe to start. When discovery gained a single
 * configuration shape, `abRunningTargets` (services/api/src/cli/discovery.main.ts)
 * made "resets both branches" false for half of all runs — and six such
 * sentences were left asserted, two of them operator-facing, in a document that
 * simultaneously stated the correct rule elsewhere. A reader had no way to tell
 * which sentence to believe.
 *
 * A grep-shaped test rather than a behavioural one, because the defect is
 * textual: the code was right and the prose was wrong. It pins the ABSENCE of
 * the falsified phrasing in the files that carry these claims, so restoring any
 * of them fails here.
 */
import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/** Repo root, from packages/protocol/eval/ops/tests. */
const ROOT = join(import.meta.dir, "..", "..", "..", "..", "..");

/**
 * Files that make destruction claims about discovery, and were each corrected.
 * A file that stops existing fails the read rather than silently passing.
 */
const SOURCES: readonly string[] = Object.freeze([
  "docs/guides/development-reference.md",
  "packages/protocol/eval/ops/ops.server.ts",
  "packages/protocol/eval/README.md",
  "packages/protocol/eval/ops/README.md",
  "services/api/src/cli/discovery.main.ts",
  "services/api/src/cli/discovery.contract.ts",
]);

/**
 * Phrasings that assert a discovery run always destroys BOTH branches.
 *
 * Each is a real sentence that was in the tree, minus the words around it. They
 * are matched case-insensitively and across the whole corpus at once, because
 * the claim is equally false wherever it appears.
 */
const FALSIFIED: readonly RegExp[] = Object.freeze([
  /every discovery run resets both/i,
  /resets both Neon branches/i,
  /destroys? both branches/i,
  /resetting two branches/i,
  /resets two branches/i,
  /it carries two configurations rather than one/i,
]);

describe("no document claims a discovery run always resets both branches", () => {
  const corpus = SOURCES.map((path) => ({ path, text: readFileSync(join(ROOT, path), "utf8") }));

  it("reads every source it claims to check", () => {
    // A path typo would make this whole file vacuous.
    for (const { path, text } of corpus) {
      expect(text.length, `${path} is empty or unreadable`).toBeGreaterThan(0);
    }
  });

  for (const pattern of FALSIFIED) {
    it(`no source says ${pattern.source}`, () => {
      const offenders = corpus
        .filter(({ text }) => pattern.test(text))
        .map(({ path, text }) => {
          const line = text.split("\n").findIndex((candidate) => pattern.test(candidate)) + 1;
          return `${path}:${line}`;
        });
      expect(
        offenders,
        `A discovery run resets only the branches its shape needs — both for a comparison, `
          + `eval-ab-a alone for a single configuration (abRunningTargets, `
          + `services/api/src/cli/discovery.main.ts). Say which, rather than asserting both.`,
      ).toEqual([]);
    });
  }

  it("the correct rule is stated where an operator will look for it", () => {
    // The absence checks above are satisfied by deleting every sentence. This
    // one requires the replacement to exist, in the two operator-facing places.
    const devRef = corpus.find((entry) => entry.path === "docs/guides/development-reference.md")!.text;
    // The single-configuration rule, stated positively.
    expect(devRef).toMatch(/resets\s+`eval-ab-a`\s+only/);
    // And on the branch inventory, which is where someone checks what a run
    // will destroy before starting one.
    expect(devRef).toMatch(/resets the branches its shape needs from the base/i);
    // Naming the function that makes it true, so the claim is checkable.
    expect(devRef).toMatch(/abRunningTargets/);
  });
});
