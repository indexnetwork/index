import { describe, it, expect } from "bun:test";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

const CLI_ROOT = join(import.meta.dir, "..");

/** All platform targets with their expected os/cpu values. */
const PLATFORMS = [
  { dir: "linux-x64", os: "linux", cpu: "x64" },
  { dir: "linux-arm64", os: "linux", cpu: "arm64" },
  { dir: "darwin-x64", os: "darwin", cpu: "x64" },
  { dir: "darwin-arm64", os: "darwin", cpu: "arm64" },
] as const;

describe("platform package.json files", () => {
  for (const platform of PLATFORMS) {
    describe(`@indexnetwork/cli-${platform.dir}`, () => {
      let pkg: Record<string, unknown>;

      it("has a valid package.json", async () => {
        const pkgPath = join(CLI_ROOT, "npm", platform.dir, "package.json");
        const raw = await readFile(pkgPath, "utf-8");
        pkg = JSON.parse(raw);
        expect(pkg).toBeDefined();
      });

      it("has the correct package name", async () => {
        const pkgPath = join(CLI_ROOT, "npm", platform.dir, "package.json");
        const raw = await readFile(pkgPath, "utf-8");
        pkg = JSON.parse(raw);
        expect(pkg.name).toBe(`@indexnetwork/cli-${platform.dir}`);
      });

      it("has the correct os field", async () => {
        const pkgPath = join(CLI_ROOT, "npm", platform.dir, "package.json");
        const raw = await readFile(pkgPath, "utf-8");
        pkg = JSON.parse(raw);
        expect(pkg.os).toEqual([platform.os]);
      });

      it("has the correct cpu field", async () => {
        const pkgPath = join(CLI_ROOT, "npm", platform.dir, "package.json");
        const raw = await readFile(pkgPath, "utf-8");
        pkg = JSON.parse(raw);
        expect(pkg.cpu).toEqual([platform.cpu]);
      });

      it("is not marked as private", async () => {
        const pkgPath = join(CLI_ROOT, "npm", platform.dir, "package.json");
        const raw = await readFile(pkgPath, "utf-8");
        pkg = JSON.parse(raw);
        expect(pkg.private).toBeUndefined();
      });

      it("has a version matching the main CLI package", async () => {
        const mainPkgPath = join(CLI_ROOT, "package.json");
        const mainRaw = await readFile(mainPkgPath, "utf-8");
        const mainPkg = JSON.parse(mainRaw);

        const pkgPath = join(CLI_ROOT, "npm", platform.dir, "package.json");
        const raw = await readFile(pkgPath, "utf-8");
        pkg = JSON.parse(raw);
        expect(pkg.version).toBe(mainPkg.version);
      });
    });
  }
});

describe("main package.json", () => {
  it("is not marked as private", async () => {
    const pkgPath = join(CLI_ROOT, "package.json");
    const raw = await readFile(pkgPath, "utf-8");
    const pkg = JSON.parse(raw);
    expect(pkg.private).toBeUndefined();
  });

  it("has optionalDependencies for all platform packages", async () => {
    const pkgPath = join(CLI_ROOT, "package.json");
    const raw = await readFile(pkgPath, "utf-8");
    const pkg = JSON.parse(raw);

    const optDeps = pkg.optionalDependencies as Record<string, string>;
    expect(optDeps).toBeDefined();

    for (const platform of PLATFORMS) {
      const depName = `@indexnetwork/cli-${platform.dir}`;
      expect(optDeps[depName]).toBeDefined();
      expect(optDeps[depName]).toBe(pkg.version);
    }
  });

  it("has bin pointing to the shim", async () => {
    const pkgPath = join(CLI_ROOT, "package.json");
    const raw = await readFile(pkgPath, "utf-8");
    const pkg = JSON.parse(raw);
    expect(pkg.bin).toEqual({ index: "bin/index.cjs" });
  });

  it("includes files for publishing", async () => {
    const pkgPath = join(CLI_ROOT, "package.json");
    const raw = await readFile(pkgPath, "utf-8");
    const pkg = JSON.parse(raw);
    const files = pkg.files as string[];
    expect(files).toBeDefined();
    expect(files).toContain("bin/");
    expect(files).toContain("dist/");
  });

  it("keeps the CLI runtime version in sync with package.json", async () => {
    const pkgPath = join(CLI_ROOT, "package.json");
    const mainTsPath = join(CLI_ROOT, "src", "main.ts");
    const raw = await readFile(pkgPath, "utf-8");
    const mainTs = await readFile(mainTsPath, "utf-8");
    const pkg = JSON.parse(raw) as { version: string };

    expect(mainTs).toContain(`const VERSION = "${pkg.version}"`);
  });
});
