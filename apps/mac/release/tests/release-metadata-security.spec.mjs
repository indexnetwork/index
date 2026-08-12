import { afterEach, expect, test } from "bun:test";
import { chmodSync, cpSync, existsSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";

const repo = resolve(import.meta.dir, "../../../..");
const release = resolve(import.meta.dir, "..");
const generator = join(release, "generate-release-metadata.ts");
const schema = join(release, "release-metadata.schema.json");
const signScript = join(release, "sign-release-metadata.sh");
const verifyScript = join(release, "verify-release-metadata.sh");
const commit = "8e676b6b143ca7339d5e7ee3391faebc2fb8f69b";
const names = ["Index-macOS-1.0.0-universal.dmg", "IndexConnector-1.0.0-universal.dmg"];
const roots = [];
afterEach(() => roots.splice(0).forEach((path) => rmSync(path, { recursive: true, force: true })));
function root() { const path = mkdtempSync(join(tmpdir(), "metadata-security-")); roots.push(path); return path; }
function run(argv, env = {}) { return Bun.spawnSync(argv, { cwd: repo, env: { ...process.env, ...env }, stdout: "pipe", stderr: "pipe" }); }
function executable(path, text) { writeFileSync(path, text); chmodSync(path, 0o755); }
function fixture(base = root()) {
  const final = join(base, "final"); const output = join(base, "output"); mkdirSync(final, { mode: 0o700 }); mkdirSync(output, { mode: 0o700 });
  names.forEach((name, index) => {
    const artifact = join(final, name); writeFileSync(artifact, index ? "connector-final" : "app-final");
    const digest = Bun.SHA256.hash(readFileSync(artifact), "hex");
    writeFileSync(`${artifact}.reproducibility.txt`, `macOS.actual=13.6.9\nmacOS.expected=13.6.9\nbuild.actual=22G830\nbuild.expected=22G830\nrunner.actual=macos-13:20240801.1\nrunner.expected=macos-13:20240801.1\nartifact.sha256=${"a".repeat(64)}\nfinalArtifact.sha256=${digest}\n`);
  });
  return { base, final, output };
}
function generate(final, output, script = generator) { return run(["bun", script, final, output, "7", commit]); }
function digest(path, algorithm) { return run(["openssl", "x509", "-in", path, "-noout", "-fingerprint", `-${algorithm}`]).stdout.toString().trim().split("=")[1].replaceAll(":", "").toUpperCase(); }
function cmsFixture() {
  const fx = fixture(); const certs = join(fx.base, "certs"); const bin = join(fx.base, "bin"); mkdirSync(certs); mkdirSync(bin);
  for (const id of ["one", "two"]) {
    const config = join(certs, `${id}.cnf`);
    writeFileSync(config, `[req]\ndistinguished_name=dn\nx509_extensions=ext\nprompt=no\n[dn]\nCN=Developer ID Application: Fixture ${id}\nOU=LMQ3XNXLAD\nO=Index Network\n[ext]\nbasicConstraints=critical,CA:false\nkeyUsage=critical,digitalSignature\nextendedKeyUsage=codeSigning\n`);
    expect(run(["openssl", "req", "-x509", "-newkey", "rsa:2048", "-nodes", "-days", "1", "-config", config, "-keyout", join(certs, `${id}.key`), "-out", join(certs, `${id}.pem`) ]).exitCode).toBe(0);
  }
  expect(generate(fx.final, fx.output).exitCode).toBe(0);
  const metadata = join(fx.output, "macos-release.json"); const cms = join(fx.output, "macos-release.cms");
  expect(run(["openssl", "cms", "-sign", "-binary", "-nodetach", "-nosmimecap", "-in", metadata, "-signer", join(certs, "one.pem"), "-inkey", join(certs, "one.key"), "-outform", "DER", "-out", cms]).exitCode).toBe(0);
  const sha1 = digest(join(certs, "one.pem"), "sha1"); const sha256 = digest(join(certs, "one.pem"), "sha256");
  executable(join(bin, "security"), `#!/usr/bin/env bash
set -euo pipefail
if [[ "$1" == find-identity ]]; then printf '  1) %s "Developer ID Application: Fixture one"\n' "$IDENTITY_SHA"; exit 0; fi
if [[ "$1" == find-certificate ]]; then cat "$CERT_ONE"; exit 0; fi
if [[ "$1 $2" == 'cms -V' || "$1 $2" == 'cms -D' ]]; then
  while (($#)); do [[ "$1" == -i ]] && input="$2"; [[ "$1" == -o ]] && output="$2"; shift; done
  openssl cms -verify -binary -noverify -purpose any -inform DER -in "$input" -out "$output" >/dev/null 2>&1
  exit
fi
exit 1
`);
  return { ...fx, certs, bin, cms, metadata, env: { PATH: `${bin}:${process.env.PATH}`, IDENTITY_SHA: sha1, CERT_ONE: join(certs, "one.pem"), INDEX_RELEASE_CMS_IDENTITY_HASH: sha1.toLowerCase(), INDEX_RELEASE_CMS_CERT_SHA256: sha256.toLowerCase() } };
}

test("committed draft-2020-12 schema is evaluated at runtime, not merely inspected", () => {
  const fx = fixture(); const copy = join(fx.base, "release"); mkdirSync(copy); cpSync(generator, join(copy, basename(generator))); cpSync(schema, join(copy, basename(schema)));
  const changed = JSON.parse(readFileSync(join(copy, basename(schema)), "utf8")); changed.properties.buildNumber.pattern = "^99$"; writeFileSync(join(copy, basename(schema)), JSON.stringify(changed));
  expect(generate(fx.final, fx.output, join(copy, basename(generator))).exitCode).not.toBe(0);
});

test("generator rejects symlink directory aliases and source links and uses descriptor-safe no-clobber writes", () => {
  const text = readFileSync(generator, "utf8");
  expect(text).toContain("O_NOFOLLOW"); expect(text).toContain("fstatSync"); expect(text).toContain("realpathSync"); expect(text).toContain("linkSync"); expect(text).not.toMatch(/renameSync\([^)]*incomplete/);
  let fx = fixture(); const alias = join(fx.base, "final-alias"); symlinkSync(fx.final, alias); expect(generate(alias, fx.output).exitCode).not.toBe(0);
  fx = fixture(); const artifact = join(fx.final, names[0]); const moved = `${artifact}.real`; cpSync(artifact, moved); rmSync(artifact); symlinkSync(moved, artifact); expect(generate(fx.final, fx.output).exitCode).not.toBe(0);
});

test("CMS contracts require exact reviewed hashes, unique selection, validated copy, and same-directory no-clobber publication", () => {
  const sign = readFileSync(signScript, "utf8"); const verify = readFileSync(verifyScript, "utf8");
  for (const text of [sign, verify]) { expect(text).toContain("cms-identity.sh"); expect(text).not.toContain("INDEX_RELEASE_CMS_SIGNING_IDENTITY"); }
  const identity = readFileSync(join(release, "cms-identity.sh"), "utf8"); expect(identity).toContain("INDEX_RELEASE_CMS_IDENTITY_HASH"); expect(identity).toContain("INDEX_RELEASE_CMS_CERT_SHA256"); expect(identity).toContain("INDEX_RELEASE_CMS_IDENTITY_SHA256");
  expect(sign).toContain("generate-release-metadata.ts"); expect(sign).toContain("validated-metadata.json"); expect(sign).toMatch(/security cms -D/); expect(sign).toContain("ln "); expect(sign).not.toMatch(/\bmv\b/);
  const cmsVerifier = readFileSync(join(release, "cms-verify.sh"), "utf8"); expect(cmsVerifier).toContain("-noverify"); expect(cmsVerifier).toContain("-purpose any"); expect(cmsVerifier).toContain("-binary");
});

test("signing refuses invalid metadata before invoking CMS and leaves no incomplete residue", () => {
  const fx = fixture(); expect(generate(fx.final, fx.output).exitCode).toBe(0); writeFileSync(join(fx.output, "macos-release.json"), "{}\n");
  const bin = join(fx.base, "bin"); mkdirSync(bin); const log = join(fx.base, "log"); executable(join(bin, "security"), `#!/usr/bin/env bash\necho "$*" >>"$LOG"\nexit 0\n`);
  const result = run(["bash", signScript, fx.final, fx.output, "7", commit], { PATH: `${bin}:${process.env.PATH}`, LOG: log, INDEX_RELEASE_CMS_IDENTITY_HASH: "a".repeat(40), INDEX_RELEASE_CMS_CERT_SHA256: "b".repeat(64) });
  expect(result.exitCode).not.toBe(0); expect(existsSync(log)).toBe(false); expect(readdirSync(fx.output).some((name) => name.includes("incomplete") || name.includes("temporary"))).toBe(false);
});

test("real opaque DER CMS with a code-signing-only cert verifies after platform trust", () => {
  const fx = cmsFixture(); const result = run(["bash", verifyScript, fx.final, fx.output, "7", commit], fx.env);
  expect(result.exitCode).toBe(0); expect(result.stderr.toString()).not.toContain(fx.env.INDEX_RELEASE_CMS_CERT_SHA256);
});

test("wrong, multiple, tampered, malformed, and detached real DER CMS are rejected", () => {
  for (const variant of ["wrong", "multiple", "tampered", "malformed", "detached"]) {
    const fx = cmsFixture();
    if (variant === "wrong") expect(run(["openssl", "cms", "-sign", "-binary", "-nodetach", "-nosmimecap", "-in", fx.metadata, "-signer", join(fx.certs, "two.pem"), "-inkey", join(fx.certs, "two.key"), "-outform", "DER", "-out", fx.cms]).exitCode).toBe(0);
    if (variant === "multiple") {
      expect(run(["openssl", "cms", "-sign", "-binary", "-nodetach", "-nosmimecap", "-in", fx.metadata, "-signer", join(fx.certs, "one.pem"), "-inkey", join(fx.certs, "one.key"), "-signer", join(fx.certs, "two.pem"), "-inkey", join(fx.certs, "two.key"), "-outform", "DER", "-out", fx.cms]).exitCode).toBe(0);
      executable(join(fx.bin, "security"), `#!/usr/bin/env bash
set -euo pipefail
if [[ "$1" == find-identity ]]; then printf '  1) %s "Developer ID Application: Fixture one"\n' "$IDENTITY_SHA"; exit 0; fi
if [[ "$1" == find-certificate ]]; then cat "$CERT_ONE"; exit 0; fi
if [[ "$1 $2" == 'cms -V' || "$1 $2" == 'cms -D' ]]; then while (($#)); do [[ "$1" == -o ]] && output="$2"; shift; done; cp "$METADATA" "$output"; exit 0; fi
exit 1
`);
      fx.env.METADATA = fx.metadata;
    }
    if (variant === "tampered") { const bytes = readFileSync(fx.cms); bytes[Math.floor(bytes.length / 2)] ^= 1; writeFileSync(fx.cms, bytes); }
    if (variant === "malformed") writeFileSync(fx.cms, "not cms");
    if (variant === "detached") expect(run(["openssl", "cms", "-sign", "-binary", "-nosmimecap", "-in", fx.metadata, "-signer", join(fx.certs, "one.pem"), "-inkey", join(fx.certs, "one.key"), "-outform", "DER", "-out", fx.cms]).exitCode).toBe(0);
    const verification = run(["bash", verifyScript, fx.final, fx.output, "7", commit], fx.env);
    expect(verification.exitCode, variant).not.toBe(0);
  }
});

test("ambiguous Keychain identity enumeration is rejected without disclosing reviewed hashes", () => {
  const fx = cmsFixture(); executable(join(fx.bin, "security"), `#!/usr/bin/env bash
if [[ "$1" == find-identity ]]; then printf '1) %s "Developer ID Application: Fixture one"\n2) %s "Developer ID Application: Duplicate"\n' "$IDENTITY_SHA" "$IDENTITY_SHA"; exit 0; fi
exit 1
`);
  const result = run(["bash", verifyScript, fx.final, fx.output, "7", commit], fx.env); expect(result.exitCode).not.toBe(0); expect(result.stderr.toString()).not.toContain(fx.env.INDEX_RELEASE_CMS_IDENTITY_HASH);
});
