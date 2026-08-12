import { afterEach, describe, expect, test } from "bun:test";
import { chmodSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";

const root = resolve(import.meta.dir, "../../../..");
const orchestrator = join(root, "apps/mac/release/build-release.sh");
const roots = [];
afterEach(() => { while (roots.length) rmSync(roots.pop(), { recursive: true, force: true }); });
const run = (command, args = [], env = {}) => spawnSync(command, args, { cwd: root, env: { ...process.env, ...env }, encoding: "utf8" });
const sha256 = (bytes) => new Bun.CryptoHasher("sha256").update(bytes).digest("hex");
const canonical = (value) => {
  const ordered = (item) => Array.isArray(item) ? item.map(ordered) : item && typeof item === "object" ? Object.fromEntries(Object.keys(item).sort().map((key) => [key, ordered(item[key])])) : item;
  return JSON.stringify(ordered(value)) + "\n";
};

function fixture() {
  const dir = mkdtempSync(join(tmpdir(), "task6-r6-")); roots.push(dir);
  const bin = join(dir, "bin"), source = join(dir, "source"), files = join(source, "files"), state = join(dir, "work", "authority", "state");
  mkdirSync(bin); mkdirSync(files, { recursive: true }); mkdirSync(state, { recursive: true });
  const version = "0.9.0", tag = `v${version}`, repository = "indexnetwork/index", commit = "a".repeat(40);
  const appName = `Index-macOS-${version}-universal.dmg`, connectorName = `IndexConnector-${version}-universal.dmg`;
  const app = Buffer.from("app"), connector = Buffer.from("connector");
  writeFileSync(join(files, appName), app); writeFileSync(join(files, connectorName), connector);
  const metadata = { apiUrl: "https://protocol.index.network", architectures: ["arm64", "x86_64"], artifacts: [
    { kind: "app-dmg", name: appName, sha256: sha256(app), size: app.length, url: `https://github.com/${repository}/releases/download/${tag}/${appName}` },
    { kind: "connector-dmg", name: connectorName, sha256: sha256(connector), size: connector.length, url: `https://github.com/${repository}/releases/download/${tag}/${connectorName}` },
  ], buildNumber: "7", commit, connectorProtocolVersion: 1, minimumMacOS: "13.0", releaseVersion: version, schemaVersion: 1, teamId: "LMQ3XNXLAD", webUrl: "https://index.network" };
  const json = join(source, "macos-release.json"), sums = join(source, "SHA256SUMS"), cms = join(source, "macos-release.cms");
  writeFileSync(json, canonical(metadata)); writeFileSync(sums, `${metadata.artifacts[0].sha256}  ${appName}\n${metadata.artifacts[1].sha256}  ${connectorName}\n`);
  const key = join(source, "key.pem"), cert = join(source, "cert.pem");
  expect(run("openssl", ["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-subj", "/CN=Fixture/OU=LMQ3XNXLAD", "-keyout", key, "-out", cert, "-days", "1"]).status).toBe(0);
  expect(run("openssl", ["cms", "-sign", "-binary", "-nodetach", "-nosmimecap", "-in", json, "-signer", cert, "-inkey", key, "-outform", "DER", "-out", cms]).status).toBe(0);
  const certDigest = run("bash", ["-c", `openssl x509 -in "$1" -outform DER | openssl dgst -sha256 -r | awk '{print $1}'`, "_", cert]).stdout.trim();
  const gh = join(bin, "gh");
  writeFileSync(gh, `#!/usr/bin/env bash\nset -euo pipefail\nif [[ "$1" == api ]]; then printf '%s\\n' "$RELEASE_RECORD"; exit 0; fi\n[[ "$1 $2" == 'release download' ]] || exit 90\npattern= output= directory=\nwhile (($#)); do case "$1" in --pattern) pattern="$2"; shift 2;; --output) output="$2"; shift 2;; --dir) directory="$2"; shift 2;; *) shift;; esac; done\ncase "$pattern" in macos-release.json) cp "$FIXTURE_SOURCE/macos-release.json" "$output";; macos-release.cms) cp "$FIXTURE_SOURCE/macos-release.cms" "$output";; 'Index*-universal.dmg') cp "$FIXTURE_SOURCE/files/"* "$directory/";; SHA256SUMS) cp "$FIXTURE_SOURCE/SHA256SUMS" "$output";; *) exit 91;; esac\n`);
  chmodSync(gh, 0o755);
  return { dir, bin, source, state, tag, repository, commit, certDigest, assets: ["macos-release.json", "macos-release.cms", appName, connectorName, "SHA256SUMS"] };
}

function validate(f, release) {
  const record = Buffer.from(JSON.stringify(release)).toString("base64");
  const command = `export BUILD_RELEASE_SOURCE_ONLY=1; source "$SCRIPT"; validate_monotonic_release`;
  return run("bash", ["-c", command], {
    SCRIPT: orchestrator,
    INDEX_RELEASE_WORK_ROOT: join(f.dir, "work"),
    INDEX_BUILD_NUMBER: "8",
    INDEX_RELEASE_CMS_CERT_SHA256: f.certDigest,
    GITHUB_REPOSITORY: f.repository,
    RELEASE_RECORD: record,
    FIXTURE_SOURCE: f.source,
    PATH: `${f.bin}:${process.env.PATH}`,
  });
}

describe("lossless historical release discovery", () => {
  test("real monotonic inventory validates macOS authority before publication posture", () => {
    const f = fixture(), assets = f.assets.map((name) => ({ name }));
    expect(validate(f, { tag_name: f.tag, draft: true, prerelease: false, assets }).status).not.toBe(0);
    expect(validate(f, { tag_name: f.tag, target_commitish: 7, draft: false, prerelease: true, assets }).status).not.toBe(0);
    expect(validate(f, { tag_name: "", draft: false, prerelease: false, assets }).status).not.toBe(0);
  });

  test("real monotonic inventory refuses shell-normalizable macOS tag authority", () => {
    const f = fixture(), base = { target_commitish: f.commit, draft: true, prerelease: false, assets: f.assets.map((name) => ({ name })) };
    for (const tag_name of [`${f.tag}\n`, `${f.tag}\n\n`, `\n${f.tag}`]) {
      const refused = validate(f, { ...base, tag_name });
      expect(refused.status, `accepted ${JSON.stringify(tag_name)}\n${refused.stdout}\n${refused.stderr}`).not.toBe(0);
    }
  });

  test("real monotonic inventory refuses missing and empty public target authority", () => {
    const f = fixture(), base = { tag_name: f.tag, draft: false, prerelease: false, assets: f.assets.map((name) => ({ name })) };
    expect(validate(f, base).status).not.toBe(0);
    expect(validate(f, { ...base, target_commitish: "" }).status).not.toBe(0);
  });

  test("real monotonic inventory accepts canonical public target and refuses signed commit mismatch", () => {
    const f = fixture(), base = { tag_name: f.tag, target_commitish: f.commit, draft: false, prerelease: false, assets: f.assets.map((name) => ({ name })) };
    const accepted = validate(f, base);
    expect(accepted.status, `${accepted.stdout}\n${accepted.stderr}`).toBe(0);
    const mismatch = { ...base, target_commitish: "b".repeat(40) };
    expect(validate(f, mismatch).status).not.toBe(0);
  });

  test("real monotonic inventory accepts an empty first-release history", () => {
    const f = fixture();
    const command = `export BUILD_RELEASE_SOURCE_ONLY=1; source "$SCRIPT"; validate_monotonic_release`;
    const accepted = run("bash", ["-c", command], {
      SCRIPT: orchestrator,
      INDEX_RELEASE_WORK_ROOT: join(f.dir, "work"),
      INDEX_BUILD_NUMBER: "8",
      INDEX_RELEASE_CMS_CERT_SHA256: f.certDigest,
      GITHUB_REPOSITORY: f.repository,
      RELEASE_RECORD: "",
      FIXTURE_SOURCE: f.source,
      PATH: `${f.bin}:${process.env.PATH}`,
    });
    expect(accepted.status, `${accepted.stdout}\n${accepted.stderr}`).toBe(0);
  });
});
