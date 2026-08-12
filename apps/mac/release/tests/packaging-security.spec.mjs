import { afterEach, expect, test } from "bun:test";
import { chmodSync, mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const repoRoot = resolve(import.meta.dir, "../../../..");
const releaseDir = resolve(import.meta.dir, "..");
const bundleScript = join(releaseDir, "notarize-bundle.sh");
const createScript = join(releaseDir, "create-dmg.sh");
const dmgScript = join(releaseDir, "notarize-dmg.sh");
const mountedScript = join(releaseDir, "verify-mounted-dmg.sh");
const orchestrator = resolve(repoRoot, "apps/mac/scripts/notarize.sh");
const fixtures = [];

afterEach(() => fixtures.splice(0).forEach((path) => rmSync(path, { recursive: true, force: true })));
function fixture() { const root = mkdtempSync(join(tmpdir(), "index-package-security-")); fixtures.push(root); return root; }
function executable(path, contents) { writeFileSync(path, contents); chmodSync(path, 0o755); }
function run(command, env = {}) { return Bun.spawnSync(["bash", "-c", command], { cwd: repoRoot, env: { ...process.env, ...env }, stdout: "pipe", stderr: "pipe" }); }
function source(path) { return readFileSync(path, "utf8"); }

const goodDmgDetails = `Executable=/tmp/candidate.dmg
Identifier=Index-macOS-1.0.0-universal.dmg
Format=disk image
Authority=Developer ID Application: Fixture (LMQ3XNXLAD)
Timestamp=Aug 9, 2026 at 12:34:56
TeamIdentifier=LMQ3XNXLAD
`;

test.each([
  ["INDEX_PRODUCTION_TEAM_ID", "WRONGTEAM1"],
  ["INDEX_APP_BUNDLE_ID", "evil.app"],
  ["INDEX_CONNECTOR_BUNDLE_ID", "evil.connector"],
  ["INDEX_FIRST_PRODUCTION_VERSION", "9.9.9"],
])("immutable release pin %s cannot be prepopulated", (name, value) => {
  const result = run('source "$SCRIPT"', { SCRIPT: bundleScript, [name]: value });
  expect(result.exitCode).not.toBe(0);
  expect(result.stderr.toString()).toContain("immutable production release pins");
});

test.each([
  [goodDmgDetails.replaceAll("LMQ3XNXLAD", "WRONGTEAM1"), "Team ID"],
  [goodDmgDetails.replace("Authority=Developer ID Application:", "Authority=Apple Development:"), "Developer ID"],
  [goodDmgDetails.replace(/Timestamp=.*\n/, ""), "timestamp"],
])("DMG signature authority fails closed: %s", (details, diagnostic) => {
  const root = fixture(); const bin = join(root, "bin"); mkdirSync(bin);
  executable(join(bin, "codesign"), '#!/usr/bin/env bash\nif [[ " $* " == *" -dvv "* ]]; then printf "%s" "$DMG_DETAILS" >&2; fi\n');
  const result = run('source "$SCRIPT"; verify_disk_image_signature /tmp/candidate.dmg', { SCRIPT: dmgScript, DMG_DETAILS: details, PATH: `${bin}:${process.env.PATH}` });
  expect(result.exitCode).not.toBe(0);
  expect(result.stderr.toString()).toContain(diagnostic);
});

test("accepted DMG flow validates Task 3 identity and signature before and after staple", () => {
  const script = source(dmgScript);
  expect(script).toContain("validate_production_identity");
  expect(script.match(/verify_disk_image_signature/g)?.length).toBeGreaterThanOrEqual(2);
  expect(script.indexOf("validate_production_identity")).toBeLessThan(script.indexOf("notarytool submit"));
  expect(script.lastIndexOf("verify_disk_image_signature")).toBeGreaterThan(script.indexOf("stapler staple"));
});

test("mounted inventory rejects symlink escape and extra top-level content", () => {
  const root = fixture(); const mount = join(root, "mount");
  mkdirSync(join(mount, "Index.app", "Contents"), { recursive: true });
  symlinkSync("/tmp", join(mount, "Index.app", "Contents", "escape"));
  let result = run('source "$SCRIPT"; validate_mounted_inventory "$MOUNT" Index.app', { SCRIPT: mountedScript, MOUNT: mount });
  expect(result.exitCode).not.toBe(0);
  expect(result.stderr.toString()).toContain("symlink");
  rmSync(join(mount, "Index.app", "Contents", "escape"));
  writeFileSync(join(mount, ".hidden-payload"), "payload");
  result = run('source "$SCRIPT"; validate_mounted_inventory "$MOUNT" Index.app', { SCRIPT: mountedScript, MOUNT: mount });
  expect(result.exitCode).not.toBe(0);
  expect(result.stderr.toString()).toContain("inventory");
});

test.each(["malformed", "detach"])("attach/parser and detach failure %s fails closed", (mode) => {
  const root = fixture(); const bin=join(root,"bin"); mkdirSync(bin); const dmg=join(root,"Index-macOS-1.0.0-universal.dmg"); writeFileSync(dmg,"x");
  executable(join(bin,"hdiutil"), `#!/usr/bin/env bash
if [[ "$1" == attach ]]; then
 while [[ "$1" != -mountpoint ]]; do shift; done; m="$2"; mkdir -p "$m/Index.app/Contents"
 if [[ "$MODE" == malformed ]]; then printf broken; else printf '<?xml version="1.0"?><plist version="1.0"><dict><key>system-entities</key><array><dict><key>mount-point</key><string>%s</string></dict></array></dict></plist>' "$m"; fi
else [[ "$MODE" != detach ]]
fi
`);
  const result=run('source "$SCRIPT"; uname(){ echo Darwin; }; verify_release_bundle_path(){ :; }; verify_mounted_dmg_main "$DMG"',{SCRIPT:mountedScript,DMG:dmg,MODE:mode,TMPDIR:root,PATH:`${bin}:${process.env.PATH}`});
  expect(result.exitCode).not.toBe(0);
});

test("DMG creation performs two independent pinned-host builds and requires equal hashes", () => {
  const text = source(createScript);
  for (const required of ["INDEX_RELEASE_MACOS_VERSION", "INDEX_RELEASE_MACOS_BUILD", "sw_vers -productVersion", "sw_vers -buildVersion", "GITHUB_RUNNER_IMAGE", "build_dmg_once", "cmp -s", "sha256"]) {
    expect(text).toContain(required);
  }
  expect(text.match(/build_dmg_once/g)?.length).toBeGreaterThanOrEqual(3);
});

test.each([
  {},
  { INDEX_RELEASE_MACOS_VERSION: "99.0", INDEX_RELEASE_MACOS_BUILD: "FIXTURE" },
])("absent or mismatched pinned host refuses before hdiutil: %o", (values) => {
  const result = run('source "$SCRIPT"; uname() { printf "Darwin\\n"; }; sw_vers() { if [[ "$1" == -productVersion ]]; then printf "14.6\\n"; else printf "23G80\\n"; fi; }; validate_reproducible_host', { SCRIPT: createScript, ...values });
  expect(result.exitCode).not.toBe(0);
  expect(result.stderr.toString()).toContain("pinned macOS");
});

test("staged bundle, ZIP extraction, and mounted unsigned candidate use exact inventory and real verification wrappers", () => {
  const bundle = source(bundleScript); const create = source(createScript); const dmg = source(dmgScript);
  expect(bundle).toContain("validate_exact_product_tree");
  expect(bundle).toContain("ditto -x -k");
  expect(bundle).toMatch(/ditto -x -k[\s\S]*verify_release_bundle_path/);
  expect(create).toMatch(/ditto --norsrc[\s\S]*verify_release_bundle_path/);
  expect(dmg).toMatch(/verify_mounted_candidate[\s\S]*codesign --force/);
  expect(dmg).toContain('source "$1"; validate_secure_timestamp');
});

test("phase digests bind unsigned, signed submission, and stapled final bytes", () => {
  const text = source(dmgScript);
  expect(text).toContain("unsigned_digest");
  expect(text).toContain("signed_digest");
  expect(text).toContain("stapled_digest");
  expect(text).toMatch(/signed_digest[\s\S]*notarytool submit[\s\S]*require_same_digest/);
  expect(text).toMatch(/stapled_digest[\s\S]*run_final_verification[\s\S]*require_same_digest/);
});

test("orchestrator keeps candidates private and atomically promotes only after all gates", () => {
  const text = source(orchestrator);
  expect(text).toContain("mktemp -d");
  expect(text).toContain("promote_release_set");
  expect(text).not.toMatch(/create-dmg\.sh[\s\S]{0,200}\$FINAL_DIRECTORY\/Index/);
  expect(text.lastIndexOf('promote_release_set "$transaction"')).toBeGreaterThan(text.lastIndexOf("verify-mounted-dmg.sh"));
});
