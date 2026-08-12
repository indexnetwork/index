import { afterEach, describe, expect, test } from "bun:test";
import { chmodSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import YAML from "yaml";

const root = resolve(import.meta.dir, "../../../..");
const workflowPath = join(root, ".github/workflows/mac-production-release.yml");
const orchestrator = join(root, "apps/mac/release/build-release.sh");
const inventory = join(root, "apps/mac/release/sealed-inventory.py");
const scanner = join(root, "apps/mac/release/process-isolation.py");
const rules = join(root, "apps/mac/release/verify-tag-ruleset.mjs");
const prior = join(root, "apps/mac/release/verify-prior-release-metadata.sh");
const roots = [];
afterEach(() => { while (roots.length) rmSync(roots.pop(), { recursive: true, force: true }); });
const fixture = () => { const path = mkdtempSync(join(tmpdir(), "task6-r4-")); roots.push(path); return path; };
const run = (command, args = [], env = {}) => spawnSync(command, args, { cwd: root, env: { ...process.env, ...env }, encoding: "utf8" });

function certFixture(directory) {
  const key = join(directory, "key.pem"), cert = join(directory, "cert.pem");
  expect(run("openssl", ["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-subj", "/CN=Fixture/OU=LMQ3XNXLAD", "-keyout", key, "-out", cert, "-days", "1"]).status).toBe(0);
  const sha = run("bash", ["-c", `openssl x509 -in "$1" -outform DER | openssl dgst -sha256 -r | awk '{print $1}'`, "_", cert]).stdout.trim();
  return { key, cert, sha };
}

function metadata(version, commit, repository, tag, app, connector) {
  return {
    apiUrl: "https://protocol.index.network", architectures: ["arm64", "x86_64"],
    artifacts: [
      { kind: "app-dmg", name: `Index-macOS-${version}-universal.dmg`, sha256: new Bun.CryptoHasher("sha256").update(app).digest("hex"), size: app.length, url: `https://github.com/${repository}/releases/download/${tag}/Index-macOS-${version}-universal.dmg` },
      { kind: "connector-dmg", name: `IndexConnector-${version}-universal.dmg`, sha256: new Bun.CryptoHasher("sha256").update(connector).digest("hex"), size: connector.length, url: `https://github.com/${repository}/releases/download/${tag}/IndexConnector-${version}-universal.dmg` },
    ],
    buildNumber: "7", commit, connectorProtocolVersion: 1, minimumMacOS: "13.0", releaseVersion: version,
    schemaVersion: 1, teamId: "LMQ3XNXLAD", webUrl: "https://index.network",
  };
}

function canonical(value) { const ordered = (item) => Array.isArray(item) ? item.map(ordered) : item && typeof item === "object" ? Object.fromEntries(Object.keys(item).sort().map((key) => [key, ordered(item[key])])) : item; return JSON.stringify(ordered(value)) + "\n"; }

describe("external sealed release authority", () => {
  test("workflow uses one private runner-temp root and literal pins on each privileged first-party step", () => {
    const text = readFileSync(workflowPath, "utf8"), workflow = YAML.parse(text);
    expect(workflow.jobs.release.env).not.toHaveProperty("INDEX_RELEASE_WORK_ROOT");
    expect(workflow.jobs.release.env).not.toHaveProperty("INDEX_RELEASE_SCRIPT_PINS");
    for (const phase of ["authorize", "candidate"]) {
      const step = workflow.jobs.release.steps.find((value) => typeof value.run === "string" && value.run.includes(`build-release.sh ${phase}`));
      expect(step.run).toMatch(/[0-9a-f]{64}  apps\/mac\/release\/build-release\.sh/);
      expect(step.run).toContain("/usr/bin/git diff-index --quiet");
    }
    const publish = workflow.jobs.publish.steps.find((value) => typeof value.run === "string" && value.run.includes("build-release.sh publish"));
    expect(publish.run).toMatch(/[0-9a-f]{64}  apps\/mac\/release\/build-release\.sh/);
    expect(publish.run).toContain("/usr/bin/shasum -a 256 -c");
    expect(publish.run).toContain("/usr/bin/git diff-index --quiet");
    expect(text).toContain("${{ runner.temp }}/index-production-${{ github.run_id }}-${{ github.run_attempt }}/artifacts/candidate");
  });

  test("seal binds canonical root identity and approved parser returns only exact artifact files", () => {
    const dir = fixture(), tree = join(dir, "tree"), authority = join(dir, "authority"), seal = join(authority, "seal.tsv");
    mkdirSync(join(tree, "final"), { recursive: true, mode: 0o700 }); mkdirSync(authority, { mode: 0o700 });
    writeFileSync(join(tree, "final", "artifact.dmg"), "artifact"); writeFileSync(join(tree, "evidence.txt"), "evidence");
    expect(run("python3", [inventory, "create", tree, seal]).status).toBe(0);
    const bytes = readFileSync(seal, "utf8"); expect(bytes).toMatch(/^seal-v1\t\/.*\t\d+\t\d+\n/);
    let result = run("python3", [inventory, "approved", tree, seal, "final/artifact.dmg"]);
    expect(result.status).not.toBe(0);
    result = run("python3", [inventory, "approved", tree, seal, "final/artifact.dmg", "evidence.txt"]);
    expect(result.status).toBe(0); expect(result.stdout.trim().split("\n")).toHaveLength(2); expect(result.stdout).not.toContain("\td\t");
    writeFileSync(join(tree, "added"), "x"); expect(run("python3", [inventory, "verify", tree, seal]).status).not.toBe(0);
  });

  test("orchestrator cleans checkout outputs before source gate and publishes only approved inventory entries", () => {
    const text = readFileSync(orchestrator, "utf8");
    expect(text).toContain("INDEX_RELEASE_WORK_ROOT"); expect(text).toContain("validate_source_checkout");
    expect(text).toMatch(/candidate_release\(\).*cleanup_checkout_outputs.*validate_source_checkout.*seal_paths/s);
    expect(text).toContain("sealed-inventory.py\" approved");
    expect(text).not.toMatch(/while read -r h f;.*PUBLICATION_MANIFEST/s);
  });
});

describe("stable libproc scanner", () => {
  test("uses libproc enumeration only and production classification rejects reuse, detached worker, and hash mismatch", () => {
    const source = readFileSync(scanner, "utf8");
    expect(source).toContain("proc_listallpids"); expect(source).toContain("proc_pidinfo"); expect(source).not.toContain("subprocess"); expect(source).not.toContain('["ps"');
    const dir = fixture(), allow = join(dir, "allow"), snap = join(dir, "snapshot.tsv"); writeFileSync(allow, "/sbin/launchd\n");
    const allowSha = new Bun.CryptoHasher("sha256").update(readFileSync(allow)).digest("hex");
    const args = [scanner, "--snapshot", snap, "--root-pid", "12", "--scanner-pid", "13", "--uid", "501", "--allowlist", allow, "--allowlist-sha256", allowSha, "--listener-path", "/runner/Listener", "--listener-sha256", "a".repeat(64), "--worker-path", "/runner/Worker", "--worker-sha256", "b".repeat(64)];
    const valid = [
      "1\t0\t501\t1:1\t/sbin/launchd\t-\t1:1",
      `10\t1\t501\t10:1\t/runner/Listener\t${"a".repeat(64)}\t10:1`,
      `11\t10\t501\t11:1\t/runner/Worker\t${"b".repeat(64)}\t11:1`,
      "12\t11\t501\t12:1\t<classified>\t-\t12:1",
      "13\t12\t501\t13:1\t<vanished>\t-\t-",
    ];
    writeFileSync(snap, valid.join("\n") + "\n"); expect(run("python3", args).status).toBe(0);
    writeFileSync(snap, valid.map((line) => line.startsWith("11\t") ? line.replace(/11:1$/, "11:2") : line).join("\n") + "\n"); expect(run("python3", args).status).not.toBe(0);
    writeFileSync(snap, valid.join("\n") + `20\t1\t501\t20:1\t/runner/Worker\t${"b".repeat(64)}\t20:1\n`); expect(run("python3", args).status).not.toBe(0);
  });
});

describe("complete GitHub and historical authority", () => {
  test("ruleset matcher implements path-aware GitHub globs", () => {
    const base = { id: 7, enforcement: "active", target: "tag", bypass_actors: [], conditions: { ref_name: { include: [], exclude: [] } }, rules: [{ type: "update" }, { type: "deletion" }] };
    for (const [pattern, accepted] of [["refs/*", false], ["refs/**", true], ["refs/tags/v[0-9].[0-9].[0-9]", true], ["refs/tags/v?.?.?", true], ["refs/{tags}/**", false]]) {
      base.conditions.ref_name.include = [pattern]; const result = run("bun", [rules, JSON.stringify(base), "v1.0.0", "7"]); expect(result.status, pattern).toBe(accepted ? 0 : 1);
    }
    base.conditions.ref_name.include = ["refs/**"]; base.conditions.ref_name.exclude = ["refs/tags/v*"]; expect(run("bun", [rules, JSON.stringify(base), "v1.0.0", "7"]).status).not.toBe(0);
  });

  test("historical verifier accepts real DER CMS only for exact closed authority and matching tag/repository", () => {
    const dir = fixture(), files = join(dir, "files"); mkdirSync(files); const version = "0.9.0", tag = `v${version}`, repo = "indexnetwork/index", commit = "a".repeat(40), app = Buffer.from("app"), connector = Buffer.from("connector");
    const appName = `Index-macOS-${version}-universal.dmg`, connectorName = `IndexConnector-${version}-universal.dmg`; writeFileSync(join(files, appName), app); writeFileSync(join(files, connectorName), connector);
    const value = metadata(version, commit, repo, tag, app, connector), json = join(dir, "macos-release.json"), sums = join(dir, "SHA256SUMS"), cms = join(dir, "macos-release.cms"); writeFileSync(json, canonical(value)); writeFileSync(sums, `${value.artifacts[0].sha256}  ${appName}\n${value.artifacts[1].sha256}  ${connectorName}\n`);
    const cert = certFixture(dir); expect(run("openssl", ["cms", "-sign", "-binary", "-nodetach", "-nosmimecap", "-in", json, "-signer", cert.cert, "-inkey", cert.key, "-outform", "DER", "-out", cms]).status).toBe(0);
    const args = [prior, json, cms, files, sums, tag, repo, commit], env = { INDEX_RELEASE_CMS_CERT_SHA256: cert.sha };
    expect(run("bash", args, env).status).toBe(0);
    expect(run("bash", [...args.slice(0, -3), "v0.9.1", repo, commit], env).status).not.toBe(0);
    const extra = { ...value, extra: true }; writeFileSync(json, canonical(extra)); expect(run("bash", args, env).status).not.toBe(0);
  });

  test("draft recovery follows Link pagination and fails closed on duplicates/API failure", () => {
    const dir = fixture(), bin = join(dir, "bin"), work = join(dir, "work"); mkdirSync(bin); mkdirSync(join(work, "authority", "state"), { recursive: true });
    const exact = '{"id":42,"draft":true,"tag_name":"v1.0.0","target_commitish":"' + "a".repeat(40) + '","body":"index-production-run:9:2:' + "a".repeat(40) + '"}';
    writeFileSync(join(bin, "gh"), `#!/usr/bin/env bash
url="\${!#}"
[[ "$MODE" != failure ]] || exit 1
if [[ "$url" == *'page=1' ]]; then
  printf 'HTTP/1.1 200 OK\\nLink: <next>; rel="next"\\n\\n[]'
else
  if [[ "$MODE" == duplicate ]]; then printf 'HTTP/1.1 200 OK\\n\\n[%s,%s]' "$EXACT" "$EXACT"; else printf 'HTTP/1.1 200 OK\\n\\n[%s]' "$EXACT"; fi
fi
`); chmodSync(join(bin, "gh"), 0o755);
    const command = 'export BUILD_RELEASE_SOURCE_ONLY=1; source "$SCRIPT"; recover_created_draft_id; printf "%s" "$CREATED_RELEASE_ID"';
    const env = { SCRIPT: orchestrator, PATH: `${bin}:${process.env.PATH}`, INDEX_RELEASE_WORK_ROOT: work, GITHUB_REPOSITORY: "indexnetwork/index", INDEX_RELEASE_TAG: "v1.0.0", INDEX_RELEASE_COMMIT: "a".repeat(40), GITHUB_RUN_ID: "9", GITHUB_RUN_ATTEMPT: "2", EXACT: exact };
    let result = run("bash", ["-c", command], { ...env, MODE: "page2" }); expect(result.status).toBe(0); expect(result.stdout).toBe("42");
    result = run("bash", ["-c", command], { ...env, MODE: "duplicate" }); expect(result.status).not.toBe(0);
    result = run("bash", ["-c", command], { ...env, MODE: "failure" }); expect(result.status).not.toBe(0);
  });
});
