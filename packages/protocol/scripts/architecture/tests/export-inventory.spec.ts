import { describe, expect, test } from "bun:test";

import { collectExports, experimentalRanges } from "../export-inventory.ts";

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

  test("ignores local declarations and bare re-exports", () => {
    // Only re-exports carry a source path, which is what the inventory records.
    const source = [
      banner("Public API"),
      "export const local = 1;",
      'export * from "./wildcard.js";',
      'export { kept } from "./kept.js";',
    ].join("\n");
    expect(collectExports(source, "index.ts").map((entry) => entry.name)).toEqual(["kept"]);
  });
});
