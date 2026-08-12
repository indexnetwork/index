import { afterEach, describe, expect, test } from "bun:test";
import { chmodSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import YAML from "yaml";

const root = resolve(import.meta.dir, "../../../..");
const release = join(root, "apps/mac/release");
const workflowPath = join(root, ".github/workflows/mac-production-release.yml");
const roots = [];
afterEach(() => { while (roots.length) rmSync(roots.pop(), { recursive: true, force: true }); });
const fixture = (prefix) => { const value = mkdtempSync(join(tmpdir(), prefix)); roots.push(value); return value; };
const run = (command, args = [], env = {}, cwd = root) => spawnSync(command, args, { cwd, env: { ...process.env, ...env }, encoding: "utf8" });
const executable = (path, body) => { writeFileSync(path, body); chmodSync(path, 0o755); };
const sha256 = (bytes) => new Bun.CryptoHasher("sha256").update(bytes).digest("hex");
const workflowOn = (workflow) => workflow.on ?? workflow.true;

function evidence(architecture, overrides = {}) {
  return {
    schemaVersion: 2,
    releaseVersion: "1.0.0",
    commit: "a".repeat(40),
    artifactSha256: { app: "b".repeat(64), connector: "c".repeat(64) },
    candidateSealSha256: "d".repeat(64),
    attestationUrl: "https://github.com/indexnetwork/index/attestations/123",
    macOSVersion: "13.7.1",
    minimumMacOS: "13.0",
    architecture,
    tester: `tester-${architecture}`,
    approver: architecture === "arm64" ? "approver-arm" : "approver-intel",
    approved: true,
    quarantinePreserved: true,
    gatekeeperLaunch: true,
    standaloneConnectorInstalled: true,
    indexAppAbsentDuringStandaloneTest: true,
    appFreeHermesVerified: true,
    capabilityFamilies: ["manage:identity", "manage:premises", "manage:intents", "manage:networks", "manage:opportunities", "manage:negotiations"],
    negotiationPickupRespondConsultVerified: true,
    indexFallbackVerified: true,
    nearExpiryReconnectVerified: true,
    disconnectRevocationVerified: true,
    plaintextMigrationVerified: true,
    secretScanMatches: 0,
    uninstallVerified: true,
    reinstallVerified: true,
    screenshotHashes: ["e".repeat(64)],
    logHashes: ["f".repeat(64)],
    ...overrides,
  };
}

describe("final publication authorization", () => {
  test("workflow makes candidate private and public promotion manual-only with two evidence records", () => {
    const text = readFileSync(workflowPath, "utf8");
    const workflow = YAML.parse(text);
    const dispatch = workflowOn(workflow).workflow_dispatch;
    expect(dispatch.inputs.operation.options).toEqual(["candidate", "publish"]);
    expect(dispatch.inputs["candidate-run-id"].required).toBe(false);
    expect(dispatch.inputs["candidate-run-attempt"].required).toBe(false);
    expect(dispatch.inputs["arm64-evidence"].required).toBe(false);
    expect(dispatch.inputs["x86_64-evidence"].required).toBe(false);
    expect(workflow.jobs.release.if).toContain("operation != 'publish'");
    expect(workflow.jobs.publish.if).toContain("operation == 'publish'");
    expect(workflow.jobs.publish.env.INDEX_RELEASE_PUBLISH_WORKFLOW_SHA).toBe("${{ github.sha }}");
    expect(workflow.jobs.publish.steps.find((step) => step.name.includes("Checkout exact approved"))?.with.ref).toBe("${{ inputs.commit }}");
    expect(text).toContain("actions/download-artifact@");
    expect(text).toContain("verify-clean-account-evidence.ts");
    const patch = text.indexOf("build-release.sh publish");
    expect(patch).toBeGreaterThan(text.indexOf("arm64-evidence"));
    expect(patch).toBeGreaterThan(text.indexOf("x86_64-evidence"));
  });

  test("exact candidate-byte gate rejects missing, duplicate, mismatched, unapproved, and tampered evidence", () => {
    const script = join(release, "verify-clean-account-evidence.ts"), handoffScript = join(release, "candidate-handoff.ts");
    const dir = fixture("clean-pair-"), candidate = join(dir, "candidate"), handoff = join(dir, "handoff");
    mkdirSync(candidate);
    const appName = "Index-macOS-1.0.0-universal.dmg", connectorName = "IndexConnector-1.0.0-universal.dmg";
    const app = Buffer.from("exact app bytes"), connector = Buffer.from("exact connector bytes");
    writeFileSync(join(candidate, appName), app); writeFileSync(join(candidate, connectorName), connector);
    const metadata = { releaseVersion: "1.0.0", buildNumber: "7", commit: "a".repeat(40), minimumMacOS: "13.0", artifacts: [
      { name: appName, sha256: sha256(app), size: app.length }, { name: connectorName, sha256: sha256(connector), size: connector.length },
    ] };
    writeFileSync(join(candidate, "macos-release.json"), JSON.stringify(metadata) + "\n");
    writeFileSync(join(candidate, "macos-release.cms"), "cms"); writeFileSync(join(candidate, "SHA256SUMS"), "sums");
    const marker = join(dir, "attestation.complete");
    writeFileSync(marker, `${"d".repeat(64)}\nhttps://github.com/indexnetwork/index/attestations/123\n`);
    expect(run("bun", [handoffScript, "create", candidate, marker, handoff, "12345", "2"]).status).toBe(0);
    const manifest = JSON.parse(readFileSync(join(handoff, "candidate-manifest.json"), "utf8"));
    const seal = readFileSync(join(handoff, "candidate-manifest.sha256"), "utf8").trim();
    const binding = { artifactSha256: { app: sha256(app), connector: sha256(connector) }, candidateSealSha256: seal };
    const arm = join(dir, "arm.json"), intel = join(dir, "intel.json");
    writeFileSync(arm, JSON.stringify(evidence("arm64", binding)) + "\n");
    writeFileSync(intel, JSON.stringify(evidence("x86_64", binding)) + "\n");
    expect(run("bun", [script, "--pair", arm]).status).not.toBe(0);
    expect(run("bun", [handoffScript, "verify-for-publish", handoff, arm, arm, "12345", "2"]).status).not.toBe(0);
    writeFileSync(intel, JSON.stringify(evidence("x86_64", { ...binding, commit: "9".repeat(40) })) + "\n");
    expect(run("bun", [handoffScript, "verify-for-publish", handoff, arm, intel, "12345", "2"]).status).not.toBe(0);
    writeFileSync(intel, JSON.stringify(evidence("x86_64", { ...binding, approved: false })) + "\n");
    expect(run("bun", [handoffScript, "verify-for-publish", handoff, arm, intel, "12345", "2"]).status).not.toBe(0);
    writeFileSync(intel, JSON.stringify(evidence("x86_64", binding)) + "\n");
    expect(run("bun", [handoffScript, "verify-for-publish", handoff, arm, intel, "12345", "2"]).status).toBe(0);
    expect(run("bun", [handoffScript, "verify-for-publish", handoff, arm, intel, "54321", "2"]).status).not.toBe(0);
    writeFileSync(join(handoff, appName), "tampered");
    expect(run("bun", [handoffScript, "verify-for-publish", handoff, arm, intel, "12345", "2"]).status).not.toBe(0);
    expect(manifest.attestationUrl).toBe("https://github.com/indexnetwork/index/attestations/123");
  });
});

describe("protected shell compatibility", () => {
  test("repeated isolation guard uses external sealed state and every runner pin", () => {
    const source = readFileSync(join(release, "build-release-isolation-guard.sh"), "utf8");
    expect(source).toContain('INDEX_RELEASE_WORK_ROOT');
    expect(source).toContain('authority/state');
    expect(source).toContain('$state/process.allow');
    for (const arg of ["--listener-path", "--listener-sha256", "--worker-path", "--worker-sha256"]) expect(source).toContain(arg);
    expect(source).not.toContain("../dist/.production-release-state");
  });

  test("isolation guard executes exact invocation and fails closed for missing or tampered state", () => {
    const dir = fixture("isolation-guard-");
    const work = join(dir, "work"), state = join(work, "authority/state"), bin = join(dir, "bin"), log = join(dir, "log");
    mkdirSync(state, { recursive: true }); mkdirSync(bin);
    const allow = "/sbin/launchd\n"; writeFileSync(join(state, "process.allow"), allow);
    executable(join(bin, "python3"), `#!/bin/sh\nprintf '%s\\n' "$*" > "$LOG"\n`);
    const env = { PATH: `${bin}:${process.env.PATH}`, LOG: log, INDEX_RELEASE_WORK_ROOT: work, INDEX_RELEASE_PROCESS_ALLOWLIST_SHA256: sha256(allow), INDEX_RELEASE_RUNNER_LISTENER_PATH: "/listener", INDEX_RELEASE_RUNNER_LISTENER_SHA256: "a".repeat(64), INDEX_RELEASE_RUNNER_WORKER_PATH: "/worker", INDEX_RELEASE_RUNNER_WORKER_SHA256: "b".repeat(64) };
    expect(run("bash", [join(release, "build-release-isolation-guard.sh")], env).status).toBe(0);
    const invocation = readFileSync(log, "utf8");
    for (const value of [join(state, "process.allow"), "--listener-path /listener", `--listener-sha256 ${"a".repeat(64)}`, "--worker-path /worker", `--worker-sha256 ${"b".repeat(64)}`]) expect(invocation).toContain(value);
    rmSync(join(state, "process.allow"));
    expect(run("bash", [join(release, "build-release-isolation-guard.sh")], env).status).not.toBe(0);
  });

  test("CMS identity executes Bash-3-compatible lowercase resolution for both signing sources", () => {
    const identity = readFileSync(join(release, "cms-identity.sh"), "utf8");
    expect(identity).not.toMatch(/\$\{BASH_REMATCH\[[0-9]+\],,\}/);
    expect(identity).toContain("tr '[:upper:]' '[:lower:]'");
    const dir = fixture("cms-bash3-"), bin = join(dir, "bin"), key = join(dir, "key.pem"), cert = join(dir, "cert.pem"); mkdirSync(bin);
    expect(run("openssl", ["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-subj", "/CN=Developer ID Application: Fixture/OU=LMQ3XNXLAD", "-keyout", key, "-out", cert, "-days", "1"]).status).toBe(0);
    const certHash = run("bash", ["-c", `openssl x509 -in "$1" -outform DER | openssl dgst -sha256 -r | awk '{print $1}'`, "_", cert]).stdout.trim();
    executable(join(bin, "security"), `#!/bin/sh\ncase "$1" in find-identity) printf '  1) AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA "Developer ID Application: Fixture"\\n';; find-certificate) cat "$CERT";; *) exit 1;; esac\n`);
    for (const signer of ["sign-release-metadata.sh", "sign-connector-release-metadata.sh"]) {
      expect(readFileSync(join(release, signer), "utf8")).toContain("cms-identity.sh");
      const command = `set -euo pipefail; source "$IDENTITY"; resolve_cms_identity "$OUT"; [[ "$CMS_RESOLVED_IDENTITY_LABEL" == "Developer ID Application: Fixture" ]]`;
      const result = run("bash", ["-c", command], { PATH: `${bin}:${process.env.PATH}`, IDENTITY: join(release, "cms-identity.sh"), OUT: join(dir, `${signer}.pem`), CERT: cert, INDEX_RELEASE_CMS_IDENTITY_HASH: "a".repeat(40), INDEX_RELEASE_CMS_CERT_SHA256: certHash, BASH_COMPAT: "3.2" });
      expect(result.status, `${signer}: ${result.stderr}`).toBe(0);
    }
  });
});

describe("current hosted macOS CI regressions", () => {
  test("macOS CI runs the full current release suite and portable fixtures", () => {
    const workflow = readFileSync(join(root, ".github/workflows/mac-app-build.yml"), "utf8");
    expect(workflow).toContain("apps/mac/release/tests/*.spec.mjs");
    const inventory = readFileSync(join(release, "sealed-inventory.py"), "utf8");
    expect(inventory).not.toContain("usedforsecurity=False");
    const mounted = readFileSync(join(release, "verify-mounted-dmg.sh"), "utf8");
    expect(mounted).toContain("mounted=1");
    expect(mounted.indexOf("mounted=1")).toBeGreaterThan(mounted.indexOf("hdiutil attach"));
    const notaryFixture = readFileSync(join(root, "apps/mac/scripts/notarize.spec.mjs"), "utf8");
    expect(notaryFixture).toContain("IndexOwnerKeychainAccessGroup");
    const universal = readFileSync(join(release, "build-universal.sh"), "utf8");
    expect(universal).toContain('run_otool -arch "$arch" -X -s __TEXT __indexcfg');
  });
});
