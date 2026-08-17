import { describe, expect, test } from "bun:test";

import { collectExports, describeDrift, experimentalRanges } from "../export-inventory.ts";

const banner = (title: string) => `// ─── ${title} ─────────────────────────────`;

describe("experimentalRanges", () => {
  test("ignores the header prose that explains the tiering", () => {
    // The real entry point says "Sections marked @experimental below" in its
    // header. Matching that would tier the entire surface experimental.
    const source = [
      "// Stability tiers are defined in STABILITY.md.",
      "//   • Experimental — Sections marked @experimental below.",
      banner("Public API"),
      'export { a } from "./a.js";',
    ].join("\n");
    expect(experimentalRanges(source)).toEqual([]);
  });

  test("scopes a marker to its own section, not to the rest of the file", () => {
    const source = [
      banner("Stable one"),
      'export { a } from "./a.js";',
      banner("States"),
      "// @experimental — internal graph-state shapes.",
      'export { b } from "./b.js";',
      banner("Stable again"),
      'export { c } from "./c.js";',
    ].join("\n");

    const entries = collectExports(source, "index.ts");
    expect(entries.map((entry) => [entry.name, entry.stability])).toEqual([
      ["a", "stable"],
      ["b", "experimental"],
      ["c", "stable"],
    ]);
  });
});

describe("collectExports", () => {
  test("records name, kind, and source for value and type re-exports", () => {
    const source = [
      banner("Public API"),
      'export { alpha, beta } from "./one.js";',
      'export type { Gamma } from "./two.js";',
      'export { delta, type Epsilon } from "./three.js";',
    ].join("\n");

    expect(collectExports(source, "index.ts")).toEqual([
      { name: "alpha", kind: "value", stability: "stable", source: "./one.js" },
      { name: "beta", kind: "value", stability: "stable", source: "./one.js" },
      { name: "Gamma", kind: "type", stability: "stable", source: "./two.js" },
      { name: "delta", kind: "value", stability: "stable", source: "./three.js" },
      { name: "Epsilon", kind: "type", stability: "stable", source: "./three.js" },
    ]);
  });

  test("records the exported name for a renamed re-export", () => {
    const source = `${banner("Public API")}\nexport { internalName as publicName } from "./a.js";`;
    expect(collectExports(source, "index.ts")).toEqual([
      { name: "publicName", kind: "value", stability: "stable", source: "./a.js" },
    ]);
  });

  test("records a namespace re-export as the single name it introduces", () => {
    const source = `${banner("Public API")}\nexport * as helpers from "./helpers.js";`;
    expect(collectExports(source, "index.ts")).toEqual([
      { name: "helpers", kind: "value", stability: "stable", source: "./helpers.js" },
    ]);
  });

  // Anything the inventory cannot describe must fail loudly. Skipping it means
  // `--check` reports "matches" while the public surface has grown unrecorded,
  // which is the exact failure the inventory exists to prevent.
  test("refuses a bare `export *`, whose members it cannot enumerate", () => {
    const source = `${banner("Public API")}\nexport * from "./wildcard.js";`;
    expect(() => collectExports(source, "index.ts")).toThrow(/export \*/);
  });

  test("refuses a locally declared export, which has no source module", () => {
    const source = `${banner("Public API")}\nexport const local = 1;`;
    expect(() => collectExports(source, "index.ts")).toThrow(/local declaration/);
  });

  test("refuses a re-export with no module specifier", () => {
    const source = `${banner("Public API")}\nconst a = 1;\nexport { a };`;
    expect(() => collectExports(source, "index.ts")).toThrow(/module specifier/);
  });
});

describe("describeDrift", () => {
  const entry = (name: string) =>
    ({ name, kind: "value", stability: "stable", source: "./a.js" }) as const;

  test("reports reordering, which a set comparison would call identical", () => {
    const before = [entry("a"), entry("b")];
    const after = [entry("b"), entry("a")];
    expect(describeDrift(before, after)).toEqual([
      "  - [0] a|value|stable|./a.js",
      "  + [0] b|value|stable|./a.js",
      "  - [1] b|value|stable|./a.js",
      "  + [1] a|value|stable|./a.js",
    ]);
  });

  test("reports a duplicated entry, which set membership also hides", () => {
    expect(describeDrift([entry("a")], [entry("a"), entry("a")])).toEqual([
      "  + [1] a|value|stable|./a.js",
    ]);
  });

  test("is empty for identical inventories", () => {
    expect(describeDrift([entry("a")], [entry("a")])).toEqual([]);
  });
});
