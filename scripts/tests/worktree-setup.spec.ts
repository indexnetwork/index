import { afterEach, describe, expect, it } from "bun:test";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, existsSync, lstatSync, readlinkSync } from "node:fs";
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

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("worktree-setup.sh", () => {
  it("links env files for backend and package workspaces into the worktree", async () => {
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
      "backend",
      "frontend",
      "packages/protocol",
      "packages/cli",
      ".worktrees/fixture/backend/node_modules",
      ".worktrees/fixture/frontend/node_modules",
      ".worktrees/fixture/packages/protocol",
      ".worktrees/fixture/packages/cli",
    ]) {
      mkdirSync(join(repo, dir), { recursive: true });
    }

    writeFileSync(join(repo, "backend", ".env.test"), "BACKEND_TEST=1\n");
    writeFileSync(join(repo, "packages/protocol", ".env.test"), "PROTOCOL_TEST=1\n");
    writeFileSync(join(repo, "packages/cli", ".env.test"), "CLI_TEST=1\n");
    writeFileSync(join(repo, "backend", ".env.example"), "IGNORE=1\n");
    writeFileSync(join(repo, "packages/protocol", ".env.example"), "IGNORE=1\n");
    writeFileSync(join(repo, "packages/cli", ".env.example"), "IGNORE=1\n");

    await run("git init", repo);
    await run("git add . && git commit -m 'init'", repo);

    const result = await run("bash scripts/worktree-setup.sh fixture", repo);

    expect(result.code).toBe(0);

    const linkedFiles = [
      ["backend/.env.test", "backend/.env.test"],
      ["packages/protocol/.env.test", "packages/protocol/.env.test"],
      ["packages/cli/.env.test", "packages/cli/.env.test"],
    ] as const;

    for (const [target, source] of linkedFiles) {
      const linkPath = join(worktreeDir, target);
      expect(existsSync(linkPath)).toBe(true);
      expect(lstatSync(linkPath).isSymbolicLink()).toBe(true);
      expect(readlinkSync(linkPath)).toBe(join(repo, source));
    }
  });
});
