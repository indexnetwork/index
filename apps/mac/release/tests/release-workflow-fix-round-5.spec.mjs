import { afterEach, describe, expect, test } from "bun:test";
import { chmodSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";

const root = resolve(import.meta.dir, "../../../..");
const orchestrator = join(root, "apps/mac/release/build-release.sh");
const inventory = join(root, "apps/mac/release/sealed-inventory.py");
const scanner = join(root, "apps/mac/release/process-isolation.py");
const rules = join(root, "apps/mac/release/verify-tag-ruleset.mjs");
const prior = join(root, "apps/mac/release/verify-prior-release-metadata.sh");
const roots = [];
afterEach(() => { while (roots.length) rmSync(roots.pop(), { recursive: true, force: true }); });
const fixture = () => { const path = mkdtempSync(join(tmpdir(), "task6-r5-")); roots.push(path); return path; };
const run = (command, args = [], env = {}) => spawnSync(command, args, { cwd: root, env: { ...process.env, ...env }, encoding: "utf8" });
const sha256 = (bytes) => new Bun.CryptoHasher("sha256").update(bytes).digest("hex");

function certFixture(directory) {
  const key = join(directory, "key.pem"), cert = join(directory, "cert.pem");
  expect(run("openssl", ["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-subj", "/CN=Fixture/OU=LMQ3XNXLAD", "-keyout", key, "-out", cert, "-days", "1"]).status).toBe(0);
  const digest = run("bash", ["-c", `openssl x509 -in "$1" -outform DER | openssl dgst -sha256 -r | awk '{print $1}'`, "_", cert]).stdout.trim();
  return { key, cert, digest };
}

function canonical(value) {
  const ordered = (item) => Array.isArray(item) ? item.map(ordered) : item && typeof item === "object" ? Object.fromEntries(Object.keys(item).sort().map((key) => [key, ordered(item[key])])) : item;
  return JSON.stringify(ordered(value)) + "\n";
}

describe("live process identity revalidation", () => {
  test("production-core snapshots bind unchanged start identity, parent, and uid", () => {
    const dir = fixture(), allow = join(dir, "allow"), snapshot = join(dir, "snapshot.tsv");
    writeFileSync(allow, "/sbin/launchd\n");
    const args = [scanner, "--snapshot", snapshot, "--root-pid", "12", "--scanner-pid", "13", "--uid", "501", "--allowlist", allow, "--allowlist-sha256", sha256(readFileSync(allow)), "--listener-path", "/runner/Listener", "--listener-sha256", "a".repeat(64), "--worker-path", "/runner/Worker", "--worker-sha256", "b".repeat(64)];
    const rows = [
      "1\t0\t501\t1:1\t/sbin/launchd\t-\t0\t501\t1:1",
      `10\t1\t501\t10:1\t/runner/Listener\t${"a".repeat(64)}\t1\t501\t10:1`,
      `11\t10\t501\t11:1\t/runner/Worker\t${"b".repeat(64)}\t10\t501\t11:1`,
      "12\t11\t501\t12:1\t<classified>\t-\t11\t501\t12:1",
      "13\t12\t501\t13:1\t<vanished>\t-\t12\t501\t-",
    ];
    writeFileSync(snapshot, rows.join("\n") + "\n");
    expect(run("python3", args).status).toBe(0);
    writeFileSync(snapshot, rows.map((line) => line.startsWith("11\t") ? line.replace("\t10\t501\t11:1", "\t1\t501\t11:1") : line).join("\n") + "\n");
    expect(run("python3", args).status).not.toBe(0);
    writeFileSync(snapshot, rows.map((line) => line.startsWith("11\t") ? line.replace("\t10\t501\t11:1", "\t10\t502\t11:1") : line).join("\n") + "\n");
    expect(run("python3", args).status).not.toBe(0);
  });
});

describe("complete ruleset pattern compilation", () => {
  test("a valid matching include cannot hide a later unsupported include", () => {
    const base = { id: 7, enforcement: "active", target: "tag", bypass_actors: [], conditions: { ref_name: { include: [], exclude: [] } }, rules: [{ type: "update" }, { type: "deletion" }] };
    for (const include of [["~ALL", "refs/{tags}/**"], ["refs/tags/v*", "refs/tags/[unterminated"]]) {
      base.conditions.ref_name.include = include;
      expect(run("bun", [rules, JSON.stringify(base), "v1.0.0", "7"]).status, include.join(",")).not.toBe(0);
    }
    base.conditions.ref_name.include = ["refs/tags/v*"];
    base.conditions.ref_name.exclude = ["refs/heads/*", "refs/{tags}/**"];
    expect(run("bun", [rules, JSON.stringify(base), "v1.0.0", "7"]).status).not.toBe(0);
  });
});

describe("historical release target authority", () => {
  test("signed metadata commit must equal one canonical target_commitish", () => {
    const dir = fixture(), files = join(dir, "files"); mkdirSync(files);
    const version = "0.9.0", tag = `v${version}`, repository = "indexnetwork/index", commit = "a".repeat(40), app = Buffer.from("app"), connector = Buffer.from("connector");
    const appName = `Index-macOS-${version}-universal.dmg`, connectorName = `IndexConnector-${version}-universal.dmg`;
    writeFileSync(join(files, appName), app); writeFileSync(join(files, connectorName), connector);
    const value = { apiUrl: "https://protocol.index.network", architectures: ["arm64", "x86_64"], artifacts: [
      { kind: "app-dmg", name: appName, sha256: sha256(app), size: app.length, url: `https://github.com/${repository}/releases/download/${tag}/${appName}` },
      { kind: "connector-dmg", name: connectorName, sha256: sha256(connector), size: connector.length, url: `https://github.com/${repository}/releases/download/${tag}/${connectorName}` },
    ], buildNumber: "7", commit, connectorProtocolVersion: 1, minimumMacOS: "13.0", releaseVersion: version, schemaVersion: 1, teamId: "LMQ3XNXLAD", webUrl: "https://index.network" };
    const json = join(dir, "macos-release.json"), sums = join(dir, "SHA256SUMS"), cms = join(dir, "macos-release.cms");
    writeFileSync(json, canonical(value)); writeFileSync(sums, `${value.artifacts[0].sha256}  ${appName}\n${value.artifacts[1].sha256}  ${connectorName}\n`);
    const cert = certFixture(dir); expect(run("openssl", ["cms", "-sign", "-binary", "-nodetach", "-nosmimecap", "-in", json, "-signer", cert.cert, "-inkey", cert.key, "-outform", "DER", "-out", cms]).status).toBe(0);
    const args = [prior, json, cms, files, sums, tag, repository], env = { INDEX_RELEASE_CMS_CERT_SHA256: cert.digest };
    expect(run("bash", [...args, commit], env).status).toBe(0);
    expect(run("bash", [...args, "b".repeat(40)], env).status).not.toBe(0);
    expect(run("bash", [...args, "main"], env).status).not.toBe(0);
    expect(run("bash", [...args, commit.toUpperCase()], env).status).not.toBe(0);
  });
});

describe("executable production handoff and upload routes", () => {
  test("real external handoff route cleans checkout before sealing and refuses unclean source", () => {
    const dir = fixture(), checkout = join(dir, "checkout"), external = join(dir, "external"), seal = join(dir, "authority", "prepare.tsv"), route = join(dir, "route");
    mkdirSync(checkout); mkdirSync(join(dir, "authority")); writeFileSync(join(checkout, "Index.app"), "unsigned");
    const command = `export BUILD_RELEASE_SOURCE_ONLY=1; source "$SCRIPT"
cleanup_checkout_outputs(){ [[ -f "$EXTERNAL/Index.app" ]] || return 31; rm -rf "$CHECKOUT"; printf 'cleanup\\n' >>"$ROUTE"; }
validate_source_checkout(){ [[ ! -e "$CHECKOUT" && ! -e "$UNCLEAN" ]] || return 32; printf 'clean\\n' >>"$ROUTE"; }
externalize_prepare_handoff "$CHECKOUT" "$EXTERNAL" "$SEAL"`;
    const env = { SCRIPT: orchestrator, INDEX_RELEASE_WORK_ROOT: join(dir, "work"), CHECKOUT: checkout, EXTERNAL: external, SEAL: seal, ROUTE: route, UNCLEAN: join(dir, "unclean") };
    let result = run("bash", ["-c", command], env); expect(result.status).toBe(0); expect(readFileSync(route, "utf8")).toBe("cleanup\nclean\n"); expect(run("python3", [inventory, "verify", external, seal]).status).toBe(0);
    rmSync(external, { recursive: true }); rmSync(seal); mkdirSync(checkout); writeFileSync(join(checkout, "Index.app"), "unsigned"); writeFileSync(env.UNCLEAN, "dirty");
    result = run("bash", ["-c", command], env); expect(result.status).not.toBe(0); expect(() => readFileSync(seal)).toThrow();
  });

  test("real approved upload route sends exactly five sealed regular files and rejects inventory drift", () => {
    const names = ["Index-macOS-1.0.0-universal.dmg", "IndexConnector-1.0.0-universal.dmg", "macos-release.json", "macos-release.cms", "SHA256SUMS"];
    const execute = (shape) => {
      const dir = fixture(), work = join(dir, "work"), candidate = join(work, "artifacts", "candidate"), authority = join(work, "authority"), seal = join(authority, "publication.seal.tsv"), route = join(dir, "route");
      mkdirSync(candidate, { recursive: true }); mkdirSync(authority, { recursive: true });
      for (const name of names) writeFileSync(join(candidate, name), name);
      if (shape === "missing") rmSync(join(candidate, names[4]));
      if (shape === "extra") writeFileSync(join(candidate, "extra.txt"), "extra");
      if (shape === "non-file") { rmSync(join(candidate, names[4])); mkdirSync(join(candidate, names[4])); }
      expect(run("python3", [inventory, "create", candidate, seal]).status).toBe(0);
      const command = `export BUILD_RELEASE_SOURCE_ONLY=1; source "$SCRIPT"
api(){ [[ "$1" == POST && "$2" == https://uploads.invalid/assets?name=* ]] || return 41; shift 2; [[ "$1" == -H && "$3" == --input && -f "$4" && ! -L "$4" ]] || return 42; basename "$4" >>"$ROUTE"; printf '{}'; }
upload_approved_candidate 'https://uploads.invalid/assets'`;
      return { result: run("bash", ["-c", command], { SCRIPT: orchestrator, INDEX_RELEASE_WORK_ROOT: work, ROUTE: route }), route };
    };
    const exact = execute("exact"); expect(exact.result.status).toBe(0); expect(readFileSync(exact.route, "utf8").trim().split("\n")).toEqual(names);
    for (const shape of ["missing", "extra", "non-file"]) { const outcome = execute(shape); expect(outcome.result.status, shape).not.toBe(0); expect(outcome.result.stdout).not.toContain("PATCH"); }
  });
});
