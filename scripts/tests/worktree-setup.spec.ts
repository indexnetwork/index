import { afterEach, describe, expect, it } from "bun:test";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, existsSync, lstatSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const tempDirs: string[] = [];

function makeTempRepo() {
  const dir = mkdtempSync(join(tmpdir(), "worktree-setup-"));
  tempDirs.push(dir);
  return dir;
}

function run(cmd: string, cwd: string) {
  const proc = Bun.spawn(["bash", "-lc", cmd], {
    cwd,
    stdout: "pipe",
    stderr: "pipe",
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: "Test User",
      GIT_AUTHOR_EMAIL: "test@example.com",
      GIT_COMMITTER_NAME: "Test User",
      GIT_COMMITTER_EMAIL: "test@example.com",
    },
  });

  return proc.exited.then(async (code) => {
    const stdout = await new Response(proc.stdout).text();
    const stderr = await new Response(proc.stderr).text();
    return { code, stdout, stderr };
  });
}

/**
 * Scaffold a minimal repo + fixture worktree. Runtime env files live at the
 * repo root; legacy package dirs may still hold not-yet-migrated files.
 */
async function scaffoldRepo() {
  const repo = makeTempRepo();
  const scriptSrc = resolve(import.meta.dir, "..", "worktree-setup.sh");
  const scriptsDir = join(repo, "scripts");
  const hooksDir = join(scriptsDir, "hooks");
  const worktreeDir = join(repo, ".worktrees", "fixture");

  mkdirSync(scriptsDir, { recursive: true });
  mkdirSync(hooksDir, { recursive: true });

  writeFileSync(join(repo, "scripts", "worktree-setup.sh"), await Bun.file(scriptSrc).text());
  writeFileSync(join(hooksDir, "pre-commit"), "#!/usr/bin/env bash\n");

  for (const dir of [
    "services/api",
    "apps/web",
    "packages/protocol",
    ".worktrees/fixture/services/api/node_modules",
    ".worktrees/fixture/apps/web/node_modules",
    ".worktrees/fixture/packages/protocol",
  ]) {
    mkdirSync(join(repo, dir), { recursive: true });
  }

  return { repo, worktreeDir };
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("worktree-setup.sh", () => {
  it("links root env files into the worktree root and skips .env.example", async () => {
    const { repo, worktreeDir } = await scaffoldRepo();

    writeFileSync(join(repo, ".env.development"), "DEV=1\n");
    writeFileSync(join(repo, ".env.test"), "TEST=1\n");
    writeFileSync(join(repo, ".env.example"), "IGNORE=1\n");

    await run("git init", repo);
    await run("git add . && git commit -m 'init'", repo);

    const result = await run("bash scripts/worktree-setup.sh fixture", repo);
    expect(result.code).toBe(0);

    for (const name of [".env.development", ".env.test"]) {
      const linkPath = join(worktreeDir, name);
      expect(existsSync(linkPath)).toBe(true);
      expect(lstatSync(linkPath).isSymbolicLink()).toBe(true);
      expect(realpathSync(linkPath)).toBe(realpathSync(join(repo, name)));
    }

    expect(existsSync(join(worktreeDir, ".env.example"))).toBe(false);
  });

  it("falls back to legacy package-local env files, linking them into the worktree root", async () => {
    const { repo, worktreeDir } = await scaffoldRepo();

    // Not yet migrated: files still live in the legacy package directories.
    writeFileSync(join(repo, "services/api", ".env.development"), "LEGACY_API=1\n");
    writeFileSync(join(repo, "apps/web", ".env.local"), "LEGACY_WEB=1\n");
    writeFileSync(join(repo, "services/api", ".env.example"), "IGNORE=1\n");

    await run("git init", repo);
    await run("git add . && git commit -m 'init'", repo);

    const result = await run("bash scripts/worktree-setup.sh fixture", repo);
    expect(result.code).toBe(0);

    const devLink = join(worktreeDir, ".env.development");
    expect(lstatSync(devLink).isSymbolicLink()).toBe(true);
    expect(realpathSync(devLink)).toBe(realpathSync(join(repo, "services/api", ".env.development")));

    const localLink = join(worktreeDir, ".env.local");
    expect(lstatSync(localLink).isSymbolicLink()).toBe(true);
    expect(realpathSync(localLink)).toBe(realpathSync(join(repo, "apps/web", ".env.local")));

    expect(result.stdout).toContain("legacy:services/api");
    expect(result.stdout).toContain("migrate");
  });

  it("prefers root env files over legacy package-local ones with the same name", async () => {
    const { repo, worktreeDir } = await scaffoldRepo();

    writeFileSync(join(repo, ".env.test"), "ROOT=1\n");
    writeFileSync(join(repo, "services/api", ".env.test"), "LEGACY=1\n");
    writeFileSync(join(repo, "packages/protocol", ".env.test"), "LEGACY=1\n");

    await run("git init", repo);
    await run("git add . && git commit -m 'init'", repo);

    const result = await run("bash scripts/worktree-setup.sh fixture", repo);
    expect(result.code).toBe(0);

    const linkPath = join(worktreeDir, ".env.test");
    expect(lstatSync(linkPath).isSymbolicLink()).toBe(true);
    expect(realpathSync(linkPath)).toBe(realpathSync(join(repo, ".env.test")));
  });
});
