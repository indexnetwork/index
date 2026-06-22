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

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("worktree-setup.sh", () => {
  it("links env files for API, web, and package workspaces into the worktree", async () => {
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
      "packages/cli",
      ".worktrees/fixture/services/api/node_modules",
      ".worktrees/fixture/apps/web/node_modules",
      ".worktrees/fixture/packages/protocol",
      ".worktrees/fixture/packages/cli",
    ]) {
      mkdirSync(join(repo, dir), { recursive: true });
    }

    writeFileSync(join(repo, "services/api", ".env.test"), "API_TEST=1\n");
    writeFileSync(join(repo, "apps/web", ".env.local"), "WEB_TEST=1\n");
    writeFileSync(join(repo, "packages/protocol", ".env.test"), "PROTOCOL_TEST=1\n");
    writeFileSync(join(repo, "packages/cli", ".env.test"), "CLI_TEST=1\n");
    writeFileSync(join(repo, "services/api", ".env.example"), "IGNORE=1\n");
    writeFileSync(join(repo, "apps/web", ".env.example"), "IGNORE=1\n");
    writeFileSync(join(repo, "packages/protocol", ".env.example"), "IGNORE=1\n");
    writeFileSync(join(repo, "packages/cli", ".env.example"), "IGNORE=1\n");

    await run("git init", repo);
    await run("git add . && git commit -m 'init'", repo);

    const result = await run("bash scripts/worktree-setup.sh fixture", repo);

    expect(result.code).toBe(0);

    const linkedFiles = [
      ["services/api/.env.test", "services/api/.env.test"],
      ["apps/web/.env.local", "apps/web/.env.local"],
      ["packages/protocol/.env.test", "packages/protocol/.env.test"],
      ["packages/cli/.env.test", "packages/cli/.env.test"],
    ] as const;

    for (const [target, source] of linkedFiles) {
      const linkPath = join(worktreeDir, target);
      expect(existsSync(linkPath)).toBe(true);
      expect(lstatSync(linkPath).isSymbolicLink()).toBe(true);
      expect(realpathSync(linkPath)).toBe(realpathSync(join(repo, source)));
    }
  });
});
