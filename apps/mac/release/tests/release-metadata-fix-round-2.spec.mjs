import { afterEach, expect, test } from "bun:test";
import { chmodSync, cpSync, existsSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";

const repo = resolve(import.meta.dir, "../../../..");
const release = resolve(import.meta.dir, "..");
const generator = join(release, "generate-release-metadata.ts");
const schema = join(release, "release-metadata.schema.json");
const sign = join(release, "sign-release-metadata.sh");
const verify = join(release, "verify-release-metadata.sh");
const commit = "8e676b6b143ca7339d5e7ee3391faebc2fb8f69b";
const names = ["Index-macOS-1.0.0-universal.dmg", "IndexConnector-1.0.0-universal.dmg"];
const roots = [];
afterEach(() => roots.splice(0).forEach((path) => rmSync(path, { recursive: true, force: true })));
function run(argv, env = {}) { return Bun.spawnSync(argv, { cwd: repo, env: { ...process.env, ...env }, stdout: "pipe", stderr: "pipe" }); }
function executable(path, text) { writeFileSync(path, text); chmodSync(path, 0o755); }
function fixture() {
  const base = mkdtempSync(join(tmpdir(), "metadata-r2-")); roots.push(base); const final = join(base, "final"); const output = join(base, "output"); mkdirSync(final, { mode: 0o700 }); mkdirSync(output, { mode: 0o700 });
  names.forEach((name, index) => { const artifact = join(final, name); writeFileSync(artifact, index ? "connector" : "app"); const digest = Bun.SHA256.hash(readFileSync(artifact), "hex"); writeFileSync(`${artifact}.reproducibility.txt`, `macOS.actual=13.6.9\nmacOS.expected=13.6.9\nbuild.actual=22G830\nbuild.expected=22G830\nrunner.actual=macos-13:1\nrunner.expected=macos-13:1\nartifact.sha256=${"a".repeat(64)}\nfinalArtifact.sha256=${digest}\n`); });
  expect(run(["bun", generator, final, output, "7", commit]).exitCode).toBe(0); return { base, final, output };
}
function certificates(base) {
  const directory = join(base, "certs"); mkdirSync(directory);
  for (const id of ["one", "two"]) { const config = join(directory, `${id}.cnf`); writeFileSync(config, `[req]\ndistinguished_name=dn\nx509_extensions=ext\nprompt=no\n[dn]\nCN=Developer ID Application: Fixture ${id}\nOU=LMQ3XNXLAD\nO=Index Network\n[ext]\nkeyUsage=critical,digitalSignature\nextendedKeyUsage=codeSigning\n`); expect(run(["openssl", "req", "-x509", "-newkey", "rsa:2048", "-nodes", "-days", "1", "-config", config, "-keyout", join(directory, `${id}.key`), "-out", join(directory, `${id}.pem`)]).exitCode).toBe(0); }
  const hash = (id, algorithm) => run(["openssl", "x509", "-in", join(directory, `${id}.pem`), "-noout", "-fingerprint", `-${algorithm}`]).stdout.toString().trim().split("=")[1].replaceAll(":", "").toLowerCase();
  return { directory, identity: hash("one", "sha1"), certificate: hash("one", "sha256") };
}
function signingFixture(mode) {
  const fx = fixture(); const cert = certificates(fx.base); const bin = join(fx.base, "bin"); mkdirSync(bin); const metadata = join(fx.output, "macos-release.json"); const candidate = join(fx.base, "candidate.der");
  expect(run(["openssl", "cms", "-sign", "-binary", "-nodetach", "-nosmimecap", "-in", metadata, "-signer", join(cert.directory, mode === "wrong" ? "two.pem" : "one.pem"), "-inkey", join(cert.directory, mode === "wrong" ? "two.key" : "one.key"), "-outform", "DER", "-out", candidate]).exitCode).toBe(0);
  executable(join(bin, "security"), `#!/usr/bin/env bash
set -euo pipefail
if [[ "$1" == find-identity ]]; then printf '1) %s "Developer ID Application: Fixture one"\n' "$IDENTITY"; exit 0; fi
if [[ "$1" == find-certificate ]]; then cat "$CERT"; exit 0; fi
if [[ "$1 $2" == 'cms -S' ]]; then while (($#)); do [[ "$1" == -o ]] && output="$2"; shift; done; cp "$CANDIDATE" "$output"; exit 0; fi
if [[ "$1 $2" == 'cms -D' ]]; then while (($#)); do [[ "$1" == -i ]] && input="$2"; [[ "$1" == -o ]] && output="$2"; shift; done; openssl cms -verify -binary -noverify -purpose any -inform DER -in "$input" -out "$output" >/dev/null 2>&1; exit; fi
exit 1
`);
  return { ...fx, bin, env: { PATH: `${bin}:${process.env.PATH}`, IDENTITY: cert.identity.toUpperCase(), CERT: join(cert.directory, "one.pem"), CANDIDATE: candidate, INDEX_RELEASE_CMS_IDENTITY_HASH: cert.identity, INDEX_RELEASE_CMS_CERT_SHA256: cert.certificate } };
}

test("signer extraction pins the actual private CMS certificate before publication", () => {
  const fx = signingFixture("wrong"); const result = run(["bash", sign, fx.final, fx.output, "7", commit], fx.env);
  expect(result.exitCode).not.toBe(0); expect(existsSync(join(fx.output, "macos-release.cms"))).toBe(false); expect(readdirSync(fx.output).some((name) => name.endsWith(".owned"))).toBe(false);
});

test("concurrent CMS destination causes real failure without clobber or owned residue", () => {
  const fx = signingFixture("correct"); writeFileSync(join(fx.output, "macos-release.cms"), "concurrent-destination");
  const result = run(["bash", sign, fx.final, fx.output, "7", commit], fx.env);
  expect(result.exitCode).not.toBe(0); expect(readFileSync(join(fx.output, "macos-release.cms"), "utf8")).toBe("concurrent-destination"); expect(readdirSync(fx.output).some((name) => name.endsWith(".owned"))).toBe(false);
});

test("schema document rejects unknown and malformed keyword shapes before instance evaluation", () => {
  for (const mutate of [(value) => { value.properties.buildNumber.maxLength = 9; }, (value) => { value.properties.buildNumber.pattern = 7; }, (value) => { value.properties.buildNumber.$ref = "https://example.invalid/schema"; }]) {
    const fx = fixture(); const copy = join(fx.base, "release"); mkdirSync(copy); cpSync(generator, join(copy, basename(generator))); const changed = JSON.parse(readFileSync(schema, "utf8")); mutate(changed); writeFileSync(join(copy, basename(schema)), JSON.stringify(changed));
    rmSync(join(fx.output, "macos-release.json")); rmSync(join(fx.output, "SHA256SUMS")); expect(run(["bun", join(copy, basename(generator)), fx.final, fx.output, "7", commit]).exitCode).not.toBe(0);
  }
});

test("verification refuses CMS symlinks before invoking platform trust", () => {
  const fx = fixture(); const target = join(fx.base, "outside.cms"); writeFileSync(target, "outside"); symlinkSync(target, join(fx.output, "macos-release.cms")); const bin = join(fx.base, "bin"); mkdirSync(bin); const log = join(fx.base, "log"); executable(join(bin, "security"), `#!/usr/bin/env bash\necho called >>"$LOG"\nexit 0\n`);
  const result = run(["bash", verify, fx.final, fx.output, "7", commit], { PATH: `${bin}:${process.env.PATH}`, LOG: log, INDEX_RELEASE_CMS_IDENTITY_HASH: "a".repeat(40), INDEX_RELEASE_CMS_CERT_SHA256: "b".repeat(64) }); expect(result.exitCode).not.toBe(0); expect(existsSync(log)).toBe(false);
});

test("all CMS verifier phases use one stable private snapshot despite source replacement", () => {
  const fx = signingFixture("correct"); cpSync(fx.env.CANDIDATE, join(fx.output, "macos-release.cms")); const replacement = join(fx.base, "replacement.cms"); writeFileSync(replacement, "replacement");
  const originalSecurity = readFileSync(join(fx.bin, "security"), "utf8"); executable(join(fx.bin, "security"), originalSecurity.replace("if [[ \"$1 $2\" == 'cms -D' ]]", `if [[ "$1 $2" == 'cms -V' ]]; then while (($#)); do [[ "$1" == -i ]] && input="$2"; [[ "$1" == -o ]] && output="$2"; shift; done; openssl cms -verify -binary -noverify -purpose any -inform DER -in "$input" -out "$output" >/dev/null 2>&1; cp "$REPLACEMENT" "$SOURCE"; exit; fi\nif [[ "$1 $2" == 'cms -D' ]]`));
  const result = run(["bash", verify, fx.final, fx.output, "7", commit], { ...fx.env, REPLACEMENT: replacement, SOURCE: join(fx.output, "macos-release.cms") }); expect(result.exitCode).toBe(0); expect(readFileSync(join(fx.output, "macos-release.cms"), "utf8")).toBe("replacement"); expect(readdirSync(fx.output).some((name) => name.includes("snapshot"))).toBe(false);
});
