import { afterEach, expect, test } from "bun:test";
import { chmodSync, existsSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const repo = resolve(import.meta.dir, "../../../..");
const release = resolve(import.meta.dir, "..");
const dmgScript = join(release, "notarize-dmg.sh");
const orchestrator = resolve(repo, "apps/mac/IndexApp/notarize.sh");
const fixtures = [];

afterEach(() => fixtures.splice(0).forEach((path) => rmSync(path, { recursive: true, force: true })));
function fixture(prefix = "pkg-r4-") { const root = mkdtempSync(join(tmpdir(), prefix)); fixtures.push(root); return root; }
function executable(path, source) { writeFileSync(path, source); chmodSync(path, 0o755); }
function run(source, env = {}) {
  return Bun.spawnSync(["bash", "-c", source], { cwd: repo, env: { ...process.env, ...env }, stdout: "pipe", stderr: "pipe" });
}
function mockedDmgTools(root, accepted) {
  const bin = join(root, "bin");
  const log = join(root, "commands");
  mkdirSync(bin);
  executable(join(bin, "codesign"), '#!/usr/bin/env bash\ncandidate="${@: -1}"\nprintf "codesign:%s\\n" "$candidate" >>"$LOG"\nprintf signed >"$candidate"\n');
  executable(join(bin, "security"), "#!/usr/bin/env bash\nexit 0\n");
  executable(join(bin, "hdiutil"), "#!/usr/bin/env bash\nexit 0\n");
  executable(join(bin, "xcrun"), accepted
    ? '#!/usr/bin/env bash\nprintf "xcrun:%s\\n" "$*" >>"$LOG"\nif [[ "$1 $2" == "notarytool submit" ]]; then printf \'{"status":"Accepted"}\\n\'; elif [[ "$1 $2" == "stapler staple" ]]; then printf stapled >>"${@: -1}"; fi\n'
    : '#!/usr/bin/env bash\nprintf "xcrun:%s\\n" "$*" >>"$LOG"\nif [[ "$1 $2" == "notarytool submit" ]]; then exit 73; fi\n');
  return { bin, log };
}

test("hostile sourced call on a direct final path cannot mutate the caller-visible original on failure", () => {
  const root = fixture();
  const final = join(root, "Index-macOS-1.0.0-universal.dmg");
  writeFileSync(final, "original");
  const { bin, log } = mockedDmgTools(root, false);
  const result = run(`
    source "$SCRIPT"
    uname() { printf 'Darwin\\n'; }
    validate_production_identity() { :; }
    verify_mounted_candidate() { :; }
    verify_disk_image_signature() { :; }
    run_final_verification() { :; }
    declare -F notarize_dmg_internal >/dev/null && exit 88
    notarize_dmg_transaction "$DMG"
  `, {
    SCRIPT: dmgScript, DMG: final, LOG: log,
    CODESIGN_IDENTITY: "Developer ID Application: Provider Free Fixture",
    NOTARYTOOL_PROFILE: "provider-free-profile-name",
    PATH: `${bin}:${process.env.PATH}`,
  });
  expect(result.exitCode).not.toBe(0);
  expect(readFileSync(final, "utf8")).toBe("original");
  expect(existsSync(log) ? readFileSync(log, "utf8") : "").not.toContain(`codesign:${final}\n`);
  expect(readdirSync(root).filter((name) => name.startsWith(".index-dmg-notarize."))).toEqual([]);
});

test("Accepted DMG work replaces the designated path only after the final mounted gate", () => {
  const root = fixture();
  const final = join(root, "Index-macOS-1.0.0-universal.dmg");
  const gate = join(root, "final-gate");
  writeFileSync(final, "original");
  const { bin, log } = mockedDmgTools(root, true);
  const result = run(`
    source "$SCRIPT"
    uname() { printf 'Darwin\\n'; }
    validate_production_identity() { :; }
    verify_mounted_candidate() { :; }
    verify_disk_image_signature() { :; }
    run_final_verification() {
      [[ "$(cat "$ORIGINAL")" == original ]] || return 97
      printf 'passed:%s\\n' "$1" >"$GATE"
    }
    notarize_dmg_transaction "$DMG"
  `, {
    SCRIPT: dmgScript, DMG: final, ORIGINAL: final, GATE: gate, LOG: log,
    CODESIGN_IDENTITY: "Developer ID Application: Provider Free Fixture",
    NOTARYTOOL_PROFILE: "provider-free-profile-name",
    PATH: `${bin}:${process.env.PATH}`,
  });
  expect(result.exitCode).toBe(0);
  expect(readFileSync(gate, "utf8")).toContain(".index-dmg-notarize.");
  expect(readFileSync(final, "utf8")).toBe("signedstapled");
  expect(readdirSync(root).filter((name) => name.startsWith(".index-dmg-notarize."))).toEqual([]);
});

function releaseHarness(root, extra) {
  const final = join(root, "final");
  const signed = join(root, "signed");
  mkdirSync(signed);
  const result = run(`
    source "$SCRIPT"
    bash() {
      if [[ "$1" == *create-dmg.sh ]]; then
        printf unsigned >"$3"
        printf 'artifact.sha256=old\\n' >"$3.reproducibility.txt"
      fi
    }
    notarize_dmg_transaction() { :; }
    ${extra}
    release_main
  `, {
    SCRIPT: orchestrator, FINAL_DIRECTORY: final, SIGNED_DIRECTORY: signed,
    INDEX_RELEASE_VERSION: "1.0.0", NOTARYTOOL_PROFILE: "unused",
  });
  return { final, result };
}

test("a promotion command that moves then fails leaves no visible final set", () => {
  const root = fixture();
  const { final, result } = releaseHarness(root, 'promote_release_set() { command mv "$1" "$2"; return 91; }');
  expect(result.exitCode).not.toBe(0);
  expect(existsSync(final)).toBe(false);
  expect(readdirSync(root).filter((name) => name.startsWith(".index-final-transaction."))).toEqual([]);
});

test("post-promotion final evidence failure removes the newly promoted set", () => {
  const root = fixture();
  const { final, result } = releaseHarness(root, 'verify_final_artifact_hash() { VERIFY_COUNT=$(( ${VERIFY_COUNT:-0} + 1 )); (( VERIFY_COUNT < 3 )); }');
  expect(result.exitCode).not.toBe(0);
  expect(existsSync(final)).toBe(false);
  expect(readdirSync(root).filter((name) => name.startsWith(".index-final-transaction."))).toEqual([]);
});

test("preflight refusal never deletes or replaces an existing final set", () => {
  const root = fixture();
  const final = join(root, "final");
  mkdirSync(final);
  writeFileSync(join(final, "sentinel"), "existing");
  const result = run('source "$SCRIPT"; release_main', {
    SCRIPT: orchestrator, FINAL_DIRECTORY: final, SIGNED_DIRECTORY: join(root, "signed"),
    INDEX_RELEASE_VERSION: "1.0.0", NOTARYTOOL_PROFILE: "unused",
  });
  expect(result.exitCode).not.toBe(0);
  expect(readFileSync(join(final, "sentinel"), "utf8")).toBe("existing");
});
