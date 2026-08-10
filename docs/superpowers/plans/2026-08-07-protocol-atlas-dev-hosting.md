# Protocol Atlas Dev Hosting Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Publish the canonical Protocol Atlas at `https://dev.index.network/protocol-atlas/` while returning 404 for the same subtree on production and unknown hosts.

**Architecture:** Keep `docs/protocol-atlas/` as the only tracked atlas source. The web build validates the generated atlas, copies an explicit asset allowlist into `apps/web/dist/protocol-atlas` through a staging directory, and the Bun web server gates that subtree by request hostname before ordinary static-file and SPA handling.

**Tech Stack:** Bun 1.3, TypeScript, Vite 6, Vitest 4, Railway frontend service, dependency-free static HTML/CSS/classic JavaScript.

## Global Constraints

- `docs/protocol-atlas/` remains the single tracked atlas source; do not add a tracked copy under `apps/web/public`.
- Serve the atlas only on `dev.index.network`, `localhost`, `127.0.0.1`, and `[::1]`.
- Return the existing uncached plain-text 404 on `index.network`, `www.index.network`, and unknown hosts.
- Keep the atlas reachable only by direct URL; do not add web navigation.
- Preserve direct `file://` and ordinary static-HTTP use of `docs/protocol-atlas/index.html`.
- Copy only `index.html`, `atlas.css`, `atlas-content.js`, `atlas-core.js`, `atlas.js`, and `protocol.generated.js`.
- Fail the web build when required atlas files are missing, non-files, or generated evidence is stale.
- Read no live protocol configuration values, `.env` files, credentials, provider state, database state, or Railway variables for atlas content.
- Use TDD and run each failing test before implementation.
- Bump `apps/web` from `0.49.0` to `0.50.0`, update `apps/web/CHANGELOG.md`, and regenerate `bun.lock` before pushing.
- Remove this plan and its design spec before branch closeout.
- Do not merge the PR without separate explicit authorization after all review and verification gates are green.

---

## File Structure

- Create `apps/web/build-protocol-atlas.ts`: validate and atomically publish the canonical atlas assets into a completed Vite build.
- Create `apps/web/tests/build-protocol-atlas.test.ts`: publisher behavior, exact file set, stale-file removal, and failure preservation tests.
- Modify `apps/web/package.json`: run atlas validation before Vite and publication after Vite; bump the web version.
- Modify `apps/web/server.ts`: recognize and hostname-gate the atlas subtree.
- Modify `apps/web/tests/server.test.ts`: lock dev/local serving, slash redirect, production denial, and missing-asset behavior.
- Modify `apps/web/railway.toml`: trigger frontend rebuilds when atlas evidence or presentation inputs change.
- Modify `apps/web/CHANGELOG.md`: record dev-only Protocol Atlas publication in web `0.50.0`.
- Modify `bun.lock`: synchronize the web workspace version.
- Delete before closeout: `docs/superpowers/specs/2026-08-07-protocol-atlas-dev-hosting-design.md`.
- Delete before closeout: `docs/superpowers/plans/2026-08-07-protocol-atlas-dev-hosting.md`.

---

### Task 1: Deterministic Atlas Publisher

**Files:**
- Create: `apps/web/build-protocol-atlas.ts`
- Create: `apps/web/tests/build-protocol-atlas.test.ts`
- Modify: `apps/web/package.json`

**Interfaces:**
- Produces: `PROTOCOL_ATLAS_FILES: readonly string[]`.
- Produces: `publishProtocolAtlas(options: PublishProtocolAtlasOptions): readonly string[]`.
- `PublishProtocolAtlasOptions` contains `sourceDir: string`, `distDir: string`, and optional `copyFile(source: string, destination: string): void` for deterministic failure testing.
- Consumes: canonical files under `docs/protocol-atlas/` and an already-created Vite `dist` directory.

- [ ] **Step 1: Write publisher fixture helpers and the failing happy-path test**

Create `apps/web/tests/build-protocol-atlas.test.ts` with imports and helpers that construct all six canonical fixture files:

```ts
import { afterEach, describe, expect, test } from "vitest";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import {
  PROTOCOL_ATLAS_FILES,
  publishProtocolAtlas,
} from "../build-protocol-atlas";

const roots: string[] = [];

function fixtureRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "protocol-atlas-publish-"));
  roots.push(root);
  return root;
}

function writeSource(sourceDir: string): void {
  mkdirSync(sourceDir, { recursive: true });
  for (const file of PROTOCOL_ATLAS_FILES) {
    writeFileSync(join(sourceDir, file), `canonical:${file}\n`);
  }
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("publishProtocolAtlas", () => {
  test("publishes exactly the canonical allowlist and removes stale output", () => {
    const root = fixtureRoot();
    const sourceDir = join(root, "source");
    const distDir = join(root, "dist");
    const destination = join(distDir, "protocol-atlas");
    writeSource(sourceDir);
    mkdirSync(destination, { recursive: true });
    writeFileSync(join(destination, "stale.txt"), "stale");

    expect(publishProtocolAtlas({ sourceDir, distDir })).toEqual(PROTOCOL_ATLAS_FILES);
    expect(readdirSync(destination).sort()).toEqual([...PROTOCOL_ATLAS_FILES].sort());
    for (const file of PROTOCOL_ATLAS_FILES) {
      expect(readFileSync(join(destination, file), "utf8")).toBe(`canonical:${file}\n`);
    }
  });
});
```

- [ ] **Step 2: Run the publisher test and verify RED**

Run:

```bash
cd apps/web
bun --bun vitest run tests/build-protocol-atlas.test.ts
```

Expected: FAIL because `../build-protocol-atlas` does not exist.

- [ ] **Step 3: Add failing preservation and regular-file tests**

Append inside the same `describe` block:

```ts
  test("leaves prior output unchanged when a source file is missing", () => {
    const root = fixtureRoot();
    const sourceDir = join(root, "source");
    const distDir = join(root, "dist");
    const destination = join(distDir, "protocol-atlas");
    writeSource(sourceDir);
    rmSync(join(sourceDir, "atlas.css"));
    mkdirSync(destination, { recursive: true });
    writeFileSync(join(destination, "index.html"), "prior");

    expect(() => publishProtocolAtlas({ sourceDir, distDir })).toThrow(
      "Missing Protocol Atlas file: atlas.css",
    );
    expect(readFileSync(join(destination, "index.html"), "utf8")).toBe("prior");
    expect(existsSync(join(distDir, ".protocol-atlas-staging"))).toBe(false);
  });

  test("rejects non-file allowlist entries before replacing output", () => {
    const root = fixtureRoot();
    const sourceDir = join(root, "source");
    const distDir = join(root, "dist");
    writeSource(sourceDir);
    rmSync(join(sourceDir, "atlas.css"));
    mkdirSync(join(sourceDir, "atlas.css"));

    expect(() => publishProtocolAtlas({ sourceDir, distDir })).toThrow(
      "Protocol Atlas source is not a file: atlas.css",
    );
  });

  test("cleans staging and preserves prior output when copying fails", () => {
    const root = fixtureRoot();
    const sourceDir = join(root, "source");
    const distDir = join(root, "dist");
    const destination = join(distDir, "protocol-atlas");
    writeSource(sourceDir);
    mkdirSync(destination, { recursive: true });
    writeFileSync(join(destination, "index.html"), "prior");

    expect(() =>
      publishProtocolAtlas({
        sourceDir,
        distDir,
        copyFile(source, destinationPath) {
          if (source.endsWith("atlas.css")) throw new Error("synthetic copy failure");
          writeFileSync(destinationPath, readFileSync(source));
        },
      }),
    ).toThrow("synthetic copy failure");
    expect(readFileSync(join(destination, "index.html"), "utf8")).toBe("prior");
    expect(existsSync(join(distDir, ".protocol-atlas-staging"))).toBe(false);
  });
```

Run the focused test again. Expected: still FAIL because the publisher module is absent.

- [ ] **Step 4: Implement the minimal staged publisher**

Create `apps/web/build-protocol-atlas.ts`:

```ts
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  renameSync,
  rmSync,
  statSync,
} from "node:fs";
import { join, resolve } from "node:path";

export const PROTOCOL_ATLAS_FILES = Object.freeze([
  "index.html",
  "atlas.css",
  "atlas-content.js",
  "atlas-core.js",
  "atlas.js",
  "protocol.generated.js",
]);

type CopyFile = (source: string, destination: string) => void;

export interface PublishProtocolAtlasOptions {
  sourceDir: string;
  distDir: string;
  copyFile?: CopyFile;
}

export function publishProtocolAtlas({
  sourceDir,
  distDir,
  copyFile = copyFileSync,
}: PublishProtocolAtlasOptions): readonly string[] {
  for (const file of PROTOCOL_ATLAS_FILES) {
    const source = join(sourceDir, file);
    if (!existsSync(source)) throw new Error(`Missing Protocol Atlas file: ${file}`);
    if (!statSync(source).isFile()) {
      throw new Error(`Protocol Atlas source is not a file: ${file}`);
    }
  }

  mkdirSync(distDir, { recursive: true });
  const destination = join(distDir, "protocol-atlas");
  const staging = join(distDir, ".protocol-atlas-staging");
  const backup = join(distDir, ".protocol-atlas-backup");
  rmSync(staging, { recursive: true, force: true });
  rmSync(backup, { recursive: true, force: true });
  mkdirSync(staging);

  try {
    for (const file of PROTOCOL_ATLAS_FILES) {
      copyFile(join(sourceDir, file), join(staging, file));
    }
  } catch (error) {
    rmSync(staging, { recursive: true, force: true });
    throw error;
  }

  const hadDestination = existsSync(destination);
  try {
    if (hadDestination) renameSync(destination, backup);
    renameSync(staging, destination);
    rmSync(backup, { recursive: true, force: true });
  } catch (error) {
    rmSync(destination, { recursive: true, force: true });
    if (hadDestination && existsSync(backup)) renameSync(backup, destination);
    rmSync(staging, { recursive: true, force: true });
    throw error;
  }

  return PROTOCOL_ATLAS_FILES;
}

if (import.meta.main) {
  const files = publishProtocolAtlas({
    sourceDir: resolve(import.meta.dir, "../../docs/protocol-atlas"),
    distDir: resolve(import.meta.dir, "dist"),
  });
  console.log(`Published Protocol Atlas (${files.length} files).`);
}
```

- [ ] **Step 5: Run publisher tests and verify GREEN**

Run:

```bash
cd apps/web
bun --bun vitest run tests/build-protocol-atlas.test.ts
```

Expected: all publisher tests PASS.

- [ ] **Step 6: Wire validation before Vite and publication after Vite**

In `apps/web/package.json`, change the scripts to:

```json
"build": "bun run check:protocol-atlas && bun run build:blog && vite build && bun run publish:protocol-atlas",
"check:protocol-atlas": "bun ../../scripts/build-protocol-atlas.ts --check",
"publish:protocol-atlas": "bun build-protocol-atlas.ts"
```

Keep all existing scripts unchanged.

- [ ] **Step 7: Verify the real canonical publish path**

Run:

```bash
cd apps/web
rm -rf dist
mkdir dist
bun run check:protocol-atlas
bun run publish:protocol-atlas
diff -qr ../../docs/protocol-atlas dist/protocol-atlas
```

Expected: atlas check reports 60 nodes, 66 edges, 20 experiments, and 61 modes; publisher reports six files; `diff -qr` exits 0.

- [ ] **Step 8: Commit Task 1**

```bash
git add apps/web/build-protocol-atlas.ts apps/web/tests/build-protocol-atlas.test.ts apps/web/package.json
git commit -m "feat(web): publish protocol atlas build assets"
```

---

### Task 2: Dev-only Server Boundary

**Files:**
- Modify: `apps/web/server.ts`
- Modify: `apps/web/tests/server.test.ts`

**Interfaces:**
- Consumes: `dist/protocol-atlas` produced by Task 1.
- Produces: a `308` redirect from allowed-host `/protocol-atlas` to `/protocol-atlas/`.
- Produces: static responses beneath `/protocol-atlas/` only for `dev.index.network` and loopback hostnames.
- Preserves: existing `createWebHandler(options)` public interface and all unrelated request behavior.

- [ ] **Step 1: Extend the server fixture and write failing allowed-host tests**

In `apps/web/tests/server.test.ts`, add to `beforeEach` after the existing public fixtures:

```ts
    mkdirSync(join(distDir, "protocol-atlas"));
    writeFileSync(join(distDir, "protocol-atlas", "index.html"), "<!doctype html><title>Protocol Atlas</title>");
    writeFileSync(join(distDir, "protocol-atlas", "atlas.css"), ".atlas { display: grid; }");
```

Add these tests:

```ts
  test.each(["dev.index.network", "localhost", "127.0.0.1"])(
    "redirects the slashless atlas route on allowed host %s",
    (hostname) => {
      const fetch = createWebHandler({ distDir, metaMap: {} });
      const response = fetch(new Request(`http://${hostname}/protocol-atlas`));

      expect(response.status).toBe(308);
      expect(response.headers.get("Location")).toBe("/protocol-atlas/");
      expect(response.headers.get("Cache-Control")).toBe("no-store");
    },
  );

  test("serves atlas HTML and assets on the development host", async () => {
    const fetch = createWebHandler({ distDir, metaMap: {} });
    const html = fetch(new Request("https://dev.index.network/protocol-atlas/"));
    const css = fetch(new Request("https://dev.index.network/protocol-atlas/atlas.css"));

    expect(html.status).toBe(200);
    expect(html.headers.get("Content-Type")).toContain("text/html");
    expect(html.headers.get("Cache-Control")).toBe("no-store");
    expect(await html.text()).toContain("Protocol Atlas");
    expect(css.status).toBe(200);
    expect(css.headers.get("Content-Type")).toContain("text/css");
    expect(await css.text()).toContain("display: grid");
  });
```

- [ ] **Step 2: Run focused server tests and verify RED**

```bash
cd apps/web
bun --bun vitest run tests/server.test.ts
```

Expected: the new redirect assertions fail and production-style static handling serves the atlas without a hostname boundary.

- [ ] **Step 3: Add failing denied-host and missing-asset tests**

Append:

```ts
  test.each(["index.network", "www.index.network", "preview.example.com"])(
    "returns 404 for atlas HTML and assets on disallowed host %s",
    async (hostname) => {
      const fetch = createWebHandler({ distDir, metaMap: {} });
      for (const pathname of ["/protocol-atlas", "/protocol-atlas/", "/protocol-atlas/atlas.css"]) {
        const response = fetch(
          new Request(`https://${hostname}${pathname}`, { headers: { Accept: "text/html" } }),
        );
        expect(response.status).toBe(404);
        expect(response.headers.get("Cache-Control")).toBe("no-store");
        expect(await response.text()).toBe("Not Found");
      }
    },
  );

  test("returns a real 404 for a missing atlas asset on the development host", async () => {
    const fetch = createWebHandler({ distDir, metaMap: {} });
    const response = fetch(
      new Request("https://dev.index.network/protocol-atlas/missing.js", {
        headers: { Accept: "text/html" },
      }),
    );

    expect(response.status).toBe(404);
    expect(await response.text()).toBe("Not Found");
  });

  test("does not treat a similar SPA path as the restricted atlas subtree", async () => {
    const fetch = createWebHandler({ distDir, metaMap: {} });
    const response = fetch(
      new Request("https://index.network/protocol-atlas-notes", {
        headers: { Accept: "text/html" },
      }),
    );

    expect(response.status).toBe(200);
    expect(await response.text()).toContain("SPA entry");
  });
```

Run the focused server tests again. Expected: denied-host and missing-asset tests FAIL until routing is implemented.

- [ ] **Step 4: Implement the atlas subtree guard before generic static handling**

In `apps/web/server.ts`, add constants and helpers near the existing cache constants:

```ts
const PROTOCOL_ATLAS_PATH = "/protocol-atlas";
const PROTOCOL_ATLAS_HOSTS = new Set([
  "dev.index.network",
  "localhost",
  "127.0.0.1",
  "[::1]",
]);

function isProtocolAtlasPath(pathname: string): boolean {
  return pathname === PROTOCOL_ATLAS_PATH || pathname.startsWith(`${PROTOCOL_ATLAS_PATH}/`);
}

function protocolAtlasFilePath(distDir: string, pathname: string): string {
  if (pathname === `${PROTOCOL_ATLAS_PATH}/`) {
    return join(distDir, "protocol-atlas", "index.html");
  }
  return join(distDir, pathname.replace(/^\/+/, ""));
}
```

Inside `createWebHandler`, immediately after AASA handling and before generic static-file resolution, add:

```ts
    if (isProtocolAtlasPath(pathname)) {
      if (!PROTOCOL_ATLAS_HOSTS.has(reqUrl.hostname)) return notFound(req);

      if (pathname === PROTOCOL_ATLAS_PATH) {
        return new Response(null, {
          status: 308,
          headers: {
            "Cache-Control": NOT_FOUND_CACHE_CONTROL,
            Location: `${PROTOCOL_ATLAS_PATH}/`,
          },
        });
      }

      const atlasPath = protocolAtlasFilePath(distDir, pathname);
      if (!existsSync(atlasPath) || !statSync(atlasPath).isFile()) return notFound(req);
      const file = Bun.file(atlasPath);
      return new Response(req.method === "HEAD" ? null : file, {
        headers: {
          "Cache-Control": pathname.endsWith(".html") || pathname.endsWith("/")
            ? HTML_CACHE_CONTROL
            : STATIC_FILE_CACHE_CONTROL,
          "Content-Type": file.type,
        },
      });
    }
```

Do not alter AASA handling or the generic static/SPA branch.

- [ ] **Step 5: Run server and publisher tests and verify GREEN**

```bash
cd apps/web
bun --bun vitest run tests/server.test.ts tests/build-protocol-atlas.test.ts
```

Expected: all focused tests PASS.

- [ ] **Step 6: Run the complete web unit suite**

```bash
cd apps/web
bun run test
```

Expected: all web Vitest tests PASS.

- [ ] **Step 7: Commit Task 2**

```bash
git add apps/web/server.ts apps/web/tests/server.test.ts
git commit -m "feat(web): gate protocol atlas to dev host"
```

---

### Task 3: Railway Triggers and Web Release Metadata

**Files:**
- Modify: `apps/web/railway.toml`
- Modify: `apps/web/package.json`
- Modify: `apps/web/CHANGELOG.md`
- Modify: `bun.lock`

**Interfaces:**
- Consumes: Task 1 build scripts and Task 2 server boundary.
- Produces: frontend rebuild triggers for every atlas source/evidence input.
- Produces: web package version `0.50.0` and synchronized root lock metadata.

- [ ] **Step 1: Write the failing static contract test for deployment wiring**

Append to `apps/web/tests/build-protocol-atlas.test.ts` outside the publisher `describe`:

```ts
  test("wires validation, publication, and atlas Railway watch inputs", () => {
    const packageJson = JSON.parse(
      readFileSync(join(import.meta.dir, "..", "package.json"), "utf8"),
    ) as { scripts: Record<string, string> };
    const railway = readFileSync(join(import.meta.dir, "..", "railway.toml"), "utf8");

    expect(packageJson.scripts.build).toBe(
      "bun run check:protocol-atlas && bun run build:blog && vite build && bun run publish:protocol-atlas",
    );
    expect(railway).toContain('"/docs/protocol-atlas/**"');
    expect(railway).toContain('"/scripts/build-protocol-atlas.ts"');
    expect(railway).toContain('"/packages/protocol/**"');
  });
```

Run:

```bash
cd apps/web
bun --bun vitest run tests/build-protocol-atlas.test.ts
```

Expected: FAIL because Railway watch patterns do not yet include atlas inputs.

- [ ] **Step 2: Extend Railway frontend watch patterns**

Change `apps/web/railway.toml` to:

```toml
[build]
watchPatterns = [
  "/apps/web/**",
  "/docs/protocol-atlas/**",
  "/scripts/build-protocol-atlas.ts",
  "/scripts/tests/build-protocol-atlas.spec.ts",
  "/packages/protocol/**",
  "/bun.lock",
  "/package.json",
]
buildCommand = "bun run build:web"
```

Keep the deploy section unchanged.

- [ ] **Step 3: Verify the deployment-wiring contract passes**

```bash
cd apps/web
bun --bun vitest run tests/build-protocol-atlas.test.ts
```

Expected: PASS.

- [ ] **Step 4: Bump the web package and changelog**

In `apps/web/package.json`, change:

```json
"version": "0.50.0"
```

Under `## [Unreleased]` → `### Added` in `apps/web/CHANGELOG.md`, add:

```markdown
- Publish the dependency-free Protocol Atlas at the direct development URL
  `/protocol-atlas/`, with deterministic build-time source validation and a
  server-enforced hostname boundary that keeps production hosts at 404 (web 0.50.0).
```

- [ ] **Step 5: Regenerate and verify the lockfile**

Run from repository root:

```bash
bun install
git diff -- apps/web/package.json apps/web/CHANGELOG.md bun.lock
rg -n '"apps/web"|0\.50\.0' bun.lock apps/web/package.json
```

Expected: the workspace version is synchronized, no unrelated dependency upgrades appear, and `apps/web/package.json` reports `0.50.0`.

- [ ] **Step 6: Run full affected verification**

```bash
bun test scripts/tests/build-protocol-atlas.spec.ts scripts/tests/protocol-atlas-core.spec.ts
bun run check:protocol-atlas
cd apps/web
bun --bun vitest run tests/build-protocol-atlas.test.ts tests/server.test.ts
bun run lint
bun run build
cd ../..
bun run check:subtree-parity
git diff --check origin/dev...HEAD
```

Expected:

- Atlas tests pass and the artifact remains 60 nodes, 66 edges, 20 experiments, and 61 modes.
- Publisher/server tests and web lint pass.
- Web build creates `apps/web/dist/protocol-atlas` with exactly six files.
- Subtree parity and diff checks pass.

- [ ] **Step 7: Run a local host-boundary HTTP smoke test**

Start the built server in one terminal:

```bash
cd apps/web
PORT=4187 bun run start
```

From another terminal, run:

```bash
curl -fsS -o /tmp/protocol-atlas.html -w '%{http_code}\n' \
  -H 'Host: dev.index.network' http://127.0.0.1:4187/protocol-atlas/
curl -fsS -o /tmp/protocol-atlas.css -w '%{http_code}\n' \
  -H 'Host: dev.index.network' http://127.0.0.1:4187/protocol-atlas/atlas.css
curl -sS -o /tmp/protocol-atlas-prod.txt -w '%{http_code}\n' \
  -H 'Host: index.network' http://127.0.0.1:4187/protocol-atlas/
grep -q 'Protocol Atlas' /tmp/protocol-atlas.html
grep -q 'Not Found' /tmp/protocol-atlas-prod.txt
```

Expected status codes: `200`, `200`, `404`. Stop the local server after the probes.

- [ ] **Step 8: Commit Task 3**

```bash
git add apps/web/railway.toml apps/web/package.json apps/web/CHANGELOG.md bun.lock apps/web/tests/build-protocol-atlas.test.ts
git commit -m "chore(web): prepare protocol atlas dev release"
```

---

### Task 4: Independent Review, PR, and Verified Dev Rollout

**Files:**
- Review: all changes in `origin/dev...HEAD`.
- Delete: `docs/superpowers/specs/2026-08-07-protocol-atlas-dev-hosting-design.md`.
- Delete: `docs/superpowers/plans/2026-08-07-protocol-atlas-dev-hosting.md`.

**Interfaces:**
- Consumes: all verified implementation commits from Tasks 1–3.
- Produces: a reviewed PR into `dev`, followed only after explicit authorization by a terminal-successful Railway frontend deployment and live URL evidence.

- [ ] **Step 1: Request independent code review**

Use the `requesting-code-review` skill with the complete diff `origin/dev...HEAD`. Require the reviewer to check:

- Production hosts cannot reach atlas HTML or assets.
- The slashless redirect happens only after host authorization.
- Missing atlas files fail closed and never fall through to the SPA.
- Publisher failures preserve prior output and leave no staging residue.
- Canonical docs remain the only tracked atlas copy.
- Railway watch patterns cover atlas presentation and generated evidence inputs.
- No navigation link, external dependency, live environment content read, or unrelated change was added.

Fix every blocking finding with focused tests and rerun the affected gates before requesting re-review.

- [ ] **Step 2: Run controller-level final verification**

From repository root:

```bash
bun test scripts/tests/build-protocol-atlas.spec.ts scripts/tests/protocol-atlas-core.spec.ts
bun run check:protocol-atlas
cd apps/web
bun run test
bun run lint
bun run build
cd ../..
bun run check:subtree-parity
git diff --check origin/dev...HEAD
test "$(bun -p 'require("./apps/web/package.json").version')" = "0.50.0"
test "$(find apps/web/dist/protocol-atlas -maxdepth 1 -type f | wc -l)" -eq 6
```

Expected: every command exits 0.

- [ ] **Step 3: Delete transient planning artifacts and commit cleanup**

```bash
rm docs/superpowers/specs/2026-08-07-protocol-atlas-dev-hosting-design.md
rm docs/superpowers/plans/2026-08-07-protocol-atlas-dev-hosting.md
git add -u docs/superpowers
git commit -m "chore: remove protocol atlas hosting plans"
test ! -e docs/superpowers/specs/2026-08-07-protocol-atlas-dev-hosting-design.md
test ! -e docs/superpowers/plans/2026-08-07-protocol-atlas-dev-hosting.md
git status --short --branch
```

Expected: clean feature worktree; both transient files absent.

- [ ] **Step 4: Push the branch and verify remote convergence**

```bash
git push -u origin feat/protocol-atlas-dev-hosting
git fetch origin feat/protocol-atlas-dev-hosting
git status --short --branch
```

Expected: branch is neither ahead nor behind its upstream.

- [ ] **Step 5: Open the PR into `dev`**

Create the PR with `gh` and include:

- **New Features:** dev-only direct Protocol Atlas hosting.
- **Bug Fixes:** production/unknown host denial and missing-asset 404 behavior.
- **Documentation:** no permanent planning docs; canonical atlas remains under `docs/protocol-atlas`.
- **Tests:** exact atlas, publisher, server, web build/lint, subtree parity, and HTTP smoke evidence.
- **Caveats:** no production exposure; no new navigation link.

Fetch the PR and snapshot it with:

```bash
bun run pr:snapshot -- <PR_NUMBER>
```

Then use `manage-pr` for review readiness. Do not merge yet.

- [ ] **Step 6: Obtain separate explicit merge authorization**

After required checks and review are green, present the exact PR number, commit, verification evidence, and production-denial guarantee. Ask the user to explicitly authorize merge. A prior request to implement or deploy does not substitute for this post-gate authorization.

- [ ] **Step 7: Merge through `manage-pr` and verify Railway terminal success**

After authorization, merge the PR into `dev` through `manage-pr`. Poll the Railway `frontend` deployment with explicit scope:

- Project `Index`: `5a1f986c-e0fb-4e5f-a78b-0c58ed1b0e10`
- Environment `dev`: `455d1280-79d1-4a8d-b2ff-0f4bbecdc9ca`
- Service `frontend`: `aa371189-1215-490d-a363-baf45e8128d8`

Do not report deployment success until the newest deployment for the merged commit reaches `SUCCESS`. If it reaches `FAILED` or `CRASHED`, fetch bounded build/runtime logs and fix forward; if it reaches another terminal state, report that exact state.

- [ ] **Step 8: Probe live development and production boundaries**

Run:

```bash
curl -fsS -o /tmp/dev-protocol-atlas.html -w '%{http_code}\n' \
  https://dev.index.network/protocol-atlas/
curl -fsS -o /tmp/dev-protocol-atlas.css -w '%{http_code}\n' \
  https://dev.index.network/protocol-atlas/atlas.css
curl -sS -o /tmp/prod-protocol-atlas.txt -w '%{http_code}\n' \
  https://index.network/protocol-atlas/
grep -q 'Protocol Atlas' /tmp/dev-protocol-atlas.html
grep -q 'Not Found' /tmp/prod-protocol-atlas.txt
```

Expected status codes: `200`, `200`, `404`. Report the merged commit, Railway deployment ID/status, live dev URL, production 404 evidence, and worktree/branch cleanup performed by `manage-pr`.
