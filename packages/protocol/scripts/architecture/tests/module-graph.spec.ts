import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { parseSourceFile, runtimeModuleSpecifiers } from "../module-graph.js";

const specifiersOf = (source: string): string[] =>
  runtimeModuleSpecifiers(parseSourceFile("module.ts", source));

describe("runtimeModuleSpecifiers", () => {
  test("keeps every import form that survives the emit", () => {
    expect(specifiersOf(`
      import defaultExport from "./default.js";
      import { value } from "./named.js";
      import * as namespace from "./namespace.js";
      import "./side-effect.js";
      export { reexported } from "./reexport.js";
      export * from "./star.js";
    `)).toEqual([
      "./default.js",
      "./named.js",
      "./namespace.js",
      "./side-effect.js",
      "./reexport.js",
      "./star.js",
    ]);
  });

  test("drops every erased form", () => {
    // These are the edges that made the negotiation/questions SCC appear: a
    // module depending on a port *type* has no runtime dependency at all.
    expect(specifiersOf(`
      import type { Declared } from "./import-type.js";
      import { type OnlyA, type OnlyB } from "./inline-types.js";
      export type { Declared } from "./export-type.js";
      export { type OnlyC } from "./inline-export-types.js";
      type Deferred = import("./import-type-node.js").Thing;
    `)).toEqual([]);
  });

  test("keeps a mixed import, because its value binding still emits", () => {
    expect(specifiersOf(`import { type Shape, build } from "./mixed.js";`)).toEqual(["./mixed.js"]);
    expect(specifiersOf(`import defaultExport, { type Shape } from "./mixed-default.js";`)).toEqual(["./mixed-default.js"]);
    expect(specifiersOf(`export { type Shape, build } from "./mixed-export.js";`)).toEqual(["./mixed-export.js"]);
  });

  test("keeps a bare side-effect import, which is never type-only", () => {
    expect(specifiersOf(`import "./polyfill.js";`)).toEqual(["./polyfill.js"]);
  });

  test("finds specifiers nested below the top level", () => {
    expect(specifiersOf(`
      declare module "virtual" {
        import { nested } from "./nested.js";
      }
    `)).toEqual(["./nested.js"]);
  });
});

describe("cycle-baseline wiring", () => {
  test("the cycle check graphs runtime edges only", async () => {
    // Guards the fix itself: reverting to an all-edges collection would make
    // the check fail on erased type edges again.
    const script = await readFile(resolve(import.meta.dir, "../cycle-baseline.ts"), "utf8");
    expect(script).toContain("runtimeModuleSpecifiers");
    expect(script).not.toContain("function importSpecifiers");
  });

  test("the direction checks still count type edges", async () => {
    // Capability boundaries and host isolation answer a different question:
    // depending on a type is still a declared direction. They must NOT adopt
    // the runtime-only collection.
    for (const script of ["capability-boundaries.ts", "host-isolation.ts"]) {
      const source = await readFile(resolve(import.meta.dir, "..", script), "utf8");
      expect(source).not.toContain("runtimeModuleSpecifiers");
    }
  });
});
