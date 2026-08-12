import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dir, "../../../..");
const productionPath = resolve(root, ".github/workflows/mac-production-release.yml");
const prPath = resolve(root, ".github/workflows/mac-app-build.yml");
const orchestratorPath = resolve(root, "apps/mac/release/build-release.sh");
const readRequired = (path) => {
  expect(existsSync(path)).toBe(true);
  return readFileSync(path, "utf8");
};

const fullShaAction = /^\s+(?:-\s+)?uses:\s+[^\s@]+@[0-9a-f]{40}(?:\s+#.*)?$/gm;
const anyAction = /^\s+(?:-\s+)?uses:\s+[^\s@]+@([^\s#]+)/gm;

function jobBlock(workflow, name) {
  const match = workflow.match(new RegExp(`^  ${name}:\\n([\\s\\S]*?)(?=^  [a-zA-Z0-9_-]+:\\n|\\Z)`, "m"));
  expect(match).not.toBeNull();
  return match?.[1] ?? "";
}

function stepBlock(workflow, name) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = workflow.match(new RegExp(`^      - name: ${escaped}\\n([\\s\\S]*?)(?=^      - (?:name:|uses:)|\\Z)`, "m"));
  expect(match).not.toBeNull();
  return match?.[1] ?? "";
}

describe("protected production workflow", () => {
  test("has only protected tag/manual entrypoints and exact least privilege", () => {
    const workflow = readRequired(productionPath);
    expect(workflow).toContain("environment: macos-production");
    expect(workflow).toContain("contents: write");
    expect(workflow).toContain("id-token: write");
    // GitHub's attestation action requires this third permission in addition
    // to contents/id-token; every unrelated scope remains absent.
    expect(workflow).toContain("attestations: write");
    expect(workflow).not.toContain("pull_request:");
    expect(workflow).not.toContain("push:\n    branches:");
    expect(workflow).toMatch(/push:\n\s+tags:\n\s+- "v\*"/);
    expect(workflow).toContain("workflow_dispatch:");
    expect(workflow).toMatch(/permissions:\n\s+contents: write\n\s+id-token: write\n\s+attestations: write/);
    expect(workflow).not.toMatch(/^\s+(actions|checks|deployments|discussions|issues|packages|pages|pull-requests|repository-projects|security-events|statuses):\s+(?:read|write)/m);
  });

  test("uses one fresh hosted runner, one checkout, exact host pins, and non-cancelling serialization", () => {
    const workflow = readRequired(productionPath);
    expect(workflow).toContain("runs-on: macos-14");
    expect(workflow).toContain("RUNNER_ENVIRONMENT");
    expect(workflow).toContain("runner.environment");
    expect(workflow).toContain("INDEX_RELEASE_EXPECTED_MACOS_VERSION: ${{ vars.INDEX_RELEASE_EXPECTED_MACOS_VERSION }}");
    expect(workflow).toContain("INDEX_RELEASE_EXPECTED_MACOS_BUILD: ${{ vars.INDEX_RELEASE_EXPECTED_MACOS_BUILD }}");
    expect(workflow).toContain("INDEX_RELEASE_EXPECTED_RUNNER_IMAGE: ${{ vars.INDEX_RELEASE_EXPECTED_RUNNER_IMAGE }}");
    expect(workflow).toContain("INDEX_RELEASE_EXPECTED_RUNNER_VERSION: ${{ vars.INDEX_RELEASE_EXPECTED_RUNNER_VERSION }}");
    expect(workflow).toContain("cancel-in-progress: false");
    expect((workflow.match(/actions\/checkout@/g) ?? [])).toHaveLength(1);
    expect(workflow).not.toContain("services:");
    expect(workflow).not.toContain("container:");
  });

  test("pins every action to a reviewed full commit SHA", () => {
    const workflow = readRequired(productionPath);
    const actions = [...workflow.matchAll(anyAction)];
    expect(actions.length).toBeGreaterThanOrEqual(3);
    expect([...workflow.matchAll(fullShaAction)]).toHaveLength(actions.length);
    for (const action of actions) expect(action[1]).toMatch(/^[0-9a-f]{40}$/);
  });

  test("requires every reviewed release authority and protected secret without defaults", () => {
    const workflow = readRequired(productionPath);
    for (const literal of [
      "INDEX_API_URL: https://protocol.index.network",
      "INDEX_WEB_URL: https://index.network",
      "INDEX_EXPECTED_TEAM_ID: LMQ3XNXLAD",
      'INDEX_CONNECTOR_PROTOCOL_VERSION: "1"',
      "INDEX_RELEASE_CMS_IDENTITY_HASH: ${{ vars.INDEX_RELEASE_CMS_IDENTITY_HASH }}",
      "INDEX_RELEASE_CMS_CERT_SHA256: ${{ vars.INDEX_RELEASE_CMS_CERT_SHA256 }}",
      "INDEX_DEVELOPER_ID_CERTIFICATE_P12: ${{ secrets.INDEX_DEVELOPER_ID_CERTIFICATE_P12 }}",
      "INDEX_DEVELOPER_ID_CERTIFICATE_PASSWORD: ${{ secrets.INDEX_DEVELOPER_ID_CERTIFICATE_PASSWORD }}",
      "INDEX_APP_PROVISIONING_PROFILE_BASE64: ${{ secrets.INDEX_APP_PROVISIONING_PROFILE_BASE64 }}",
      "INDEX_CONNECTOR_PROVISIONING_PROFILE_BASE64: ${{ secrets.INDEX_CONNECTOR_PROVISIONING_PROFILE_BASE64 }}",
      "INDEX_NOTARY_API_KEY_BASE64: ${{ secrets.INDEX_NOTARY_API_KEY_BASE64 }}",
      "INDEX_NOTARY_KEY_ID: ${{ secrets.INDEX_NOTARY_KEY_ID }}",
      "INDEX_NOTARY_ISSUER_ID: ${{ secrets.INDEX_NOTARY_ISSUER_ID }}",
      "INDEX_RELEASE_TAG_RULESET_ID: ${{ vars.INDEX_RELEASE_TAG_RULESET_ID }}",
    ]) expect(workflow).toContain(literal);
    expect(workflow).not.toMatch(/INDEX_RELEASE_EXPECTED_(?:MACOS_VERSION|MACOS_BUILD|RUNNER_IMAGE|RUNNER_VERSION):\s*["']?(?:13|macOS)/);
  });

  test("attests immutable assets before the sole final publication command", () => {
    const workflow = readRequired(productionPath);
    const prepare = workflow.indexOf("build-release.sh prepare");
    const candidate = workflow.indexOf("build-release.sh candidate");
    const attest = workflow.indexOf("actions/attest-build-provenance@");
    const publish = workflow.indexOf("build-release.sh publish");
    expect(prepare).toBeGreaterThan(-1);
    expect(candidate).toBeGreaterThan(prepare);
    expect(attest).toBeGreaterThan(candidate);
    expect(publish).toBeGreaterThan(attest);
    expect((workflow.match(/gh release create/g) ?? [])).toHaveLength(0);
  });
});

describe("release orchestrator", () => {
  test("orders every protected gate before publication", () => {
    const script = readRequired(orchestratorPath);
    for (const marker of ["prepare_release", "authorize_release", "candidate_release", "publish_release", "build-universal.sh", "sign-bundles.sh", "verify-signatures.sh", "notarize.sh", "verify_final_artifact_evidence", "generate-release-metadata.ts", "sign-release-metadata.sh", "verify-release-metadata.sh", "verify_uploaded_assets", "draft:='false'"]) expect(script).toContain(marker);
    expect(script).not.toContain("gh release create");
  });

  test("fails closed on dirty/wrong provenance, host isolation, and input pin shapes", () => {
    const script = readRequired(orchestratorPath);
    expect(script).toContain("status --porcelain=v1 --untracked-files=all");
    expect(script).toContain("refs/tags/$INDEX_RELEASE_TAG^{commit}");
    expect(script).toContain("RUNNER_ENVIRONMENT");
    expect(script).toContain("github-hosted");
    expect(script).toContain("jobs -pr");
    expect(script).toContain("umask 077");
    expect(script).toContain("chmod 700");
    expect(script).toMatch(/INDEX_RELEASE_CMS_IDENTITY_HASH.+\^\[0-9a-f\]\{40\}\$/s);
    expect(script).toMatch(/INDEX_RELEASE_CMS_CERT_SHA256.+\^\[0-9a-f\]\{64\}\$/s);
  });

  test("checks finalArtifact evidence around promotion and immediately before publication", () => {
    const script = readRequired(orchestratorPath);
    const contract = script.indexOf("assert_no_unrelated_same_uid_processes");
    const promotion = script.indexOf('bash "$MAC_DIRECTORY/IndexApp/notarize.sh"');
    const checks = [...script.matchAll(/verify_final_artifact_evidence/g)].map((match) => match.index ?? -1);
    const publication = script.indexOf("draft:='false'");
    expect(contract).toBeLessThan(promotion);
    expect(script).toContain("INDEX_RELEASE_ISOLATION_GUARD");
    expect(checks.length).toBeGreaterThanOrEqual(3);
    expect(checks.some((index) => index > promotion)).toBe(true);
    expect(checks.at(-1)).toBeLessThan(publication);
  });

  test("cleans all credential material and proves release absence after failure", () => {
    const script = readRequired(orchestratorPath);
    const trap = script.indexOf("trap release_cleanup EXIT");
    expect(trap).toBeGreaterThan(-1);
    const cleanup = script.indexOf("release_cleanup(){");
    for (const value of ["TEMPORARY_KEYCHAIN", "APP_PROFILE_PATH", "CONNECTOR_PROFILE_PATH", "NOTARY_PROFILE_PATH", "TRANSACTION_ROOT"]) expect(script.indexOf(value, cleanup)).toBeGreaterThan(cleanup);
    expect(script).toContain("set +x");
    expect(script).toContain("assert_release_absent");
    expect(script).toContain("CREATED_RELEASE_ID");
    expect(script).toContain('DELETE "/repos/${GITHUB_REPOSITORY}/releases/${CREATED_RELEASE_ID}"');
  });
});

describe("PR macOS CI boundaries", () => {
  test("is read-only, provider-free on PRs, pinned, and development-only", () => {
    const workflow = readRequired(prPath);
    expect(workflow).toMatch(/permissions:\n\s+contents: read/);
    expect(workflow).not.toContain("macos-production");
    expect(workflow).not.toContain("contents: write");
    expect(workflow).not.toContain("id-token: write");
    expect(workflow).toContain("development-only");
    expect(workflow).toContain("release-workflow.spec.mjs");
    const secretStep = stepBlock(workflow, "Protected signed cross-identity Keychain fixture");
    expect(secretStep).toContain("if: github.event_name == 'workflow_dispatch'");
    const actions = [...workflow.matchAll(anyAction)];
    expect(actions.length).toBeGreaterThan(0);
    for (const action of actions) expect(action[1]).toMatch(/^[0-9a-f]{40}$/);
  });
});
