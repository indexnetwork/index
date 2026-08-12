import { afterEach, describe, expect, test } from "bun:test";
import { chmodSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import YAML from "yaml";

const root = resolve(import.meta.dir, "../../../..");
const workflowPath = join(root, ".github/workflows/mac-production-release.yml");
const scriptPath = join(root, "apps/mac/release/build-release.sh");
const priorVerifierPath = join(root, "apps/mac/release/verify-prior-release-metadata.sh");
const roots = [];
afterEach(() => { while (roots.length) rmSync(roots.pop(), { recursive: true, force: true }); });
function fixture() { const path = mkdtempSync(join(tmpdir(), "task6-r1-")); roots.push(path); return path; }
function run(shell, env = {}) { return spawnSync("bash", ["-c", shell], { cwd: root, env: { ...process.env, ...env }, encoding: "utf8" }); }
function workflow() { const text = readFileSync(workflowPath, "utf8"); return { text, doc: YAML.parse(text) }; }
function steps() { return workflow().doc.jobs.release.steps; }
const appleSecrets = ["INDEX_DEVELOPER_ID_CERTIFICATE_P12", "INDEX_DEVELOPER_ID_CERTIFICATE_PASSWORD", "INDEX_APP_PROVISIONING_PROFILE_BASE64", "INDEX_CONNECTOR_PROVISIONING_PROFILE_BASE64", "INDEX_NOTARY_API_KEY_BASE64", "INDEX_NOTARY_KEY_ID", "INDEX_NOTARY_ISSUER_ID"];

describe("parsed workflow secret and token boundaries", () => {
  test("YAML parses with exact triggers, permissions, and full action SHAs", () => {
    const { doc } = workflow();
    expect(doc.on.push.tags).toEqual(["v*"]);
    expect(doc.on.workflow_dispatch).toBeTruthy();
    expect(doc.on.pull_request).toBeUndefined();
    expect(doc.permissions).toEqual({ contents: "write", "id-token": "write", attestations: "write" });
    expect(doc.jobs.release.environment).toBe("macos-production");
    for (const step of doc.jobs.release.steps.filter((item) => item.uses)) expect(step.uses).toMatch(/@[0-9a-f]{40}$/);
  });

  test("job/action environments contain neither GitHub auth nor Apple secrets", () => {
    const { doc } = workflow();
    expect(JSON.stringify(doc.jobs.release.env ?? {})).not.toMatch(/secrets\.|GH_TOKEN/);
    for (const step of doc.jobs.release.steps.filter((item) => item.uses)) expect(JSON.stringify(step.env ?? {})).not.toMatch(/secrets\.|GH_TOKEN/);
  });

  test("GH_TOKEN is exact and only on first-party gh-using orchestrator steps", () => {
    const orchestratorSteps = steps().filter((step) => typeof step.run === "string" && step.run.includes("build-release.sh"));
    const ghSteps = orchestratorSteps.filter((step) => !step.run.includes("record-attestation"));
    expect(ghSteps).toHaveLength(3);
    for (const step of ghSteps) expect(step.env?.GH_TOKEN).toBe("${{ github.token }}");
    expect(orchestratorSteps.find((step) => step.run.includes("record-attestation"))?.env?.GH_TOKEN).toBeUndefined();
    for (const step of steps().filter((step) => step.uses)) expect(step.env?.GH_TOKEN).toBeUndefined();
  });

  test("Apple secrets exist on prepare only and workflow writes no secret files", () => {
    const releaseSteps = steps().filter((step) => typeof step.run === "string" && step.run.includes("build-release.sh"));
    const prepare = releaseSteps.find((step) => step.run.includes(" prepare"));
    expect(prepare).toBeTruthy();
    for (const name of appleSecrets) expect(prepare.env?.[name]).toBe(`\${{ secrets.${name} }}`);
    for (const step of releaseSteps.filter((step) => step !== prepare)) for (const name of appleSecrets) expect(step.env?.[name]).toBeUndefined();
    expect(workflow().text).not.toMatch(/(?:base64|security import|store-credentials)/);
  });
});

describe("executable protected-boundary fixtures", () => {
  test("credential-free build child receives no Apple or GitHub secrets", () => {
    const dir = fixture(), helper = join(dir, "helper");
    writeFileSync(helper, `#!/usr/bin/env bash\nfor n in GH_TOKEN GITHUB_TOKEN ${appleSecrets.join(" ")}; do [[ -z "\${!n:-}" ]] || exit 91; done\nprintf clean\n`); chmodSync(helper, 0o755);
    const result = run('export BUILD_RELEASE_SOURCE_ONLY=1; source "$SCRIPT"; run_credential_free_build "$HELPER"', { SCRIPT: scriptPath, HELPER: helper, GH_TOKEN: "x", GITHUB_TOKEN: "x", ...Object.fromEntries(appleSecrets.map((name) => [name, "x"])) });
    expect(result.status).toBe(0); expect(result.stdout).toContain("clean");
  });

  test("host equality executes before credential materialization", () => {
    const dir = fixture(), log = join(dir, "log");
    const result = run('export BUILD_RELEASE_SOURCE_ONLY=1; source "$SCRIPT"; validate_release_host(){ echo host >>"$LOG"; }; run_credential_free_build(){ echo build >>"$LOG"; }; install_protected_credentials(){ echo secret >>"$LOG"; }; validate_tagged_provenance(){ :; }; run_precredential_phases fixture; cat "$LOG"', { SCRIPT: scriptPath, LOG: log });
    expect(result.status).toBe(0); expect(result.stdout.trim().split("\n")).toEqual(["host", "build", "host", "secret"]);
  });

  test("tag validation rejects lightweight tags, remote drift, and missing ruleset", () => {
    const source = 'export BUILD_RELEASE_SOURCE_ONLY=1; source "$SCRIPT"; validate_tagged_provenance';
    for (const mode of ["lightweight", "drift", "ruleset-missing"]) {
      const result = run(source, { SCRIPT: scriptPath, INDEX_RELEASE_TEST_TAG_MODE: mode, INDEX_RELEASE_TAG: "v1.0.0", INDEX_RELEASE_COMMIT: "a".repeat(40), INDEX_RELEASE_TAG_RULESET_ID: "7", REPO_ROOT: root });
      expect(result.status, mode).not.toBe(0);
    }
  });

  test("numeric-ID cleanup preserves a replacement release", () => {
    const result = run('export BUILD_RELEASE_SOURCE_ONLY=1; source "$SCRIPT"; CREATED_RELEASE_ID=42; INDEX_RELEASE_TEST_RELEASE_MODE=replaced; cleanup_created_release', { SCRIPT: scriptPath, GITHUB_REPOSITORY: "indexnetwork/index", INDEX_RELEASE_TAG: "v1.0.0", INDEX_RELEASE_COMMIT: "a".repeat(40), GITHUB_RUN_ID: "1", GITHUB_RUN_ATTEMPT: "1" });
    expect(result.status).not.toBe(0);
    expect(result.stdout + result.stderr).not.toContain("DELETE /repos/indexnetwork/index/releases/42");
  });

  test("same-UID proof rejects lookalike runner and detects a late process", () => {
    const dir = fixture(), fixturePath = join(dir, "ps");
    writeFileSync(fixturePath, "100:1:0:/sbin/launchd\n101:100:1:/opt/actions-runner/bin/Runner.Worker\n102:101:100:/bin/bash\n200:1:0:/tmp/FakeRunner.Worker\n");
    let result = run('export BUILD_RELEASE_SOURCE_ONLY=1 INDEX_RELEASE_PS_FIXTURE="$PSF" INDEX_RELEASE_TEST_SHELL_PID=102; source "$SCRIPT"; assert_no_unrelated_same_uid_processes', { SCRIPT: scriptPath, PSF: fixturePath });
    expect(result.status).not.toBe(0);
    writeFileSync(fixturePath, "100:1:0:/sbin/launchd\n101:100:1:/opt/actions-runner/bin/Runner.Worker\n102:101:100:/bin/bash\n");
    result = run('export BUILD_RELEASE_SOURCE_ONLY=1 INDEX_RELEASE_PS_FIXTURE="$PSF" INDEX_RELEASE_TEST_SHELL_PID=102; source "$SCRIPT"; assert_no_unrelated_same_uid_processes; echo "200:1:0:/tmp/late" >>"$PSF"; assert_no_unrelated_same_uid_processes', { SCRIPT: scriptPath, PSF: fixturePath });
    expect(result.status).not.toBe(0);
  });

  test("unsigned or missing historical CMS fails monotonic inventory", () => {
    expect(() => readFileSync(priorVerifierPath, "utf8")).not.toThrow();
    const dir = fixture(); writeFileSync(join(dir, "macos-release.json"), '{}\n'); writeFileSync(join(dir, "macos-release.cms"), "unsigned");
    const result = run('bash "$VERIFY" "$DIR/macos-release.json" "$DIR/macos-release.cms"', { VERIFY: priorVerifierPath, DIR: dir, INDEX_RELEASE_CMS_CERT_SHA256: "a".repeat(64) });
    expect(result.status).not.toBe(0);
  });

  test("execution log rechecks isolation before Task4 phases and publication", () => {
    const source = readFileSync(scriptPath, "utf8");
    expect(source).toContain("INDEX_RELEASE_ISOLATION_GUARD");
    expect(source).toMatch(/publish_release\(\)[\s\S]*assert_no_unrelated_same_uid_processes[\s\S]*gh release create/);
    const task4 = readFileSync(join(root, "apps/mac/IndexApp/notarize.sh"), "utf8");
    expect((task4.match(/run_isolation_guard/g) ?? []).length).toBeGreaterThanOrEqual(5);
  });
});
