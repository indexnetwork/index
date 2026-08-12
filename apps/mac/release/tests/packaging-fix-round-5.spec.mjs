import { afterEach, expect, test } from "bun:test";
import { chmodSync, existsSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";

const repo = resolve(import.meta.dir, "../../../..");
const release = resolve(import.meta.dir, "..");
const dmgScript = join(release, "notarize-dmg.sh");
const orchestrator = resolve(repo, "apps/mac/scripts/notarize.sh");
const renameSource = join(release, "atomic-rename.c");
const fixtures = [];

afterEach(() => fixtures.splice(0).forEach((path) => rmSync(path, { recursive: true, force: true })));
function fixture(prefix = "pkg-r5-") { const root = mkdtempSync(join(tmpdir(), prefix)); fixtures.push(root); return root; }
function executable(path, source) { writeFileSync(path, source); chmodSync(path, 0o755); }
function run(source, env = {}) {
  return Bun.spawnSync(["bash", "-c", source], { cwd: repo, env: { ...process.env, ...env }, stdout: "pipe", stderr: "pipe" });
}
function mockedDmgTools(root, accepted = true) {
  const bin = join(root, "bin"); const log = join(root, "commands"); mkdirSync(bin);
  executable(join(bin, "codesign"), '#!/usr/bin/env bash\ncandidate="${@: -1}"\nprintf "codesign:%s\\n" "$candidate" >>"$LOG"\nprintf signed >"$candidate"\n');
  executable(join(bin, "security"), "#!/usr/bin/env bash\nexit 0\n");
  executable(join(bin, "hdiutil"), "#!/usr/bin/env bash\nexit 0\n");
  executable(join(bin, "xcrun"), accepted
    ? '#!/usr/bin/env bash\nif [[ "$1 $2" == "notarytool submit" ]]; then printf \'{"status":"Accepted"}\\n\'; elif [[ "$1 $2" == "stapler staple" ]]; then printf stapled >>"${@: -1}"; fi\n'
    : '#!/usr/bin/env bash\nif [[ "$1 $2" == "notarytool submit" ]]; then exit 73; fi\n');
  return { bin, log };
}
function transformHarness(root, accepted = true) {
  const work = join(root, "work"); const outputParent = join(root, ".index-final-candidate.fixture");
  mkdirSync(work, { mode: 0o700 }); mkdirSync(outputParent, { mode: 0o700 });
  const source = join(work, "Index-macOS-1.0.0-universal.dmg");
  const output = join(outputParent, basename(source));
  writeFileSync(source, "unsigned-original");
  writeFileSync(`${source}.reproducibility.txt`, "artifact.sha256=old\n");
  const { bin, log } = mockedDmgTools(root, accepted);
  const result = run(`
    source "$SCRIPT"
    uname() { printf 'Darwin\\n'; }
    validate_production_identity() { :; }
    verify_mounted_candidate() { :; }
    verify_disk_image_signature() { :; }
    run_final_verification() { :; }
    notarize_dmg_transform "$SOURCE" "$OUTPUT"
  `, {
    SCRIPT: dmgScript, SOURCE: source, OUTPUT: output, LOG: log,
    CODESIGN_IDENTITY: "Developer ID Application: Provider Free Fixture",
    NOTARYTOOL_PROFILE: "provider-free-profile-name", PATH: `${bin}:${process.env.PATH}`,
  });
  return { source, output, result };
}

test("DMG transform leaves immutable source unchanged on success and emits final-hash-bound private output", () => {
  const root = fixture(); const { source, output, result } = transformHarness(root);
  expect(result.exitCode).toBe(0);
  expect(readFileSync(source, "utf8")).toBe("unsigned-original");
  expect(readFileSync(output, "utf8")).toBe("signedstapled");
  const evidence = readFileSync(`${output}.reproducibility.txt`, "utf8");
  const digest = run('shasum -a 256 "$OUTPUT" | awk "{print \\$1}"', { OUTPUT: output }).stdout.toString().trim();
  expect(evidence).toContain(`finalArtifact.sha256=${digest}`);
});

test("DMG transform failure cannot change source or publish an output", () => {
  const root = fixture(); const { source, output, result } = transformHarness(root, false);
  expect(result.exitCode).not.toBe(0);
  expect(readFileSync(source, "utf8")).toBe("unsigned-original");
  expect(existsSync(output)).toBe(false);
  expect(existsSync(`${output}.reproducibility.txt`)).toBe(false);
});

test("DMG transform rejects equal, dist/final, and preexisting output paths without mutation", () => {
  const text = readFileSync(dmgScript, "utf8");
  expect(text).not.toContain("mv -f");
  expect(text).toContain('notarize_dmg_transform "$@"');
  expect(text).not.toContain("notarize_dmg_transaction");
  const root = fixture(); const source = join(root, "Index-macOS-1.0.0-universal.dmg"); writeFileSync(source, "original");
  let result = run('source "$SCRIPT"; notarize_dmg_transform "$SOURCE" "$SOURCE"', { SCRIPT: dmgScript, SOURCE: source });
  expect(result.exitCode).not.toBe(0); expect(readFileSync(source, "utf8")).toBe("original");
  const finalDir = join(root, "dist", "final"); mkdirSync(finalDir, { recursive: true }); const output = join(finalDir, basename(source)); writeFileSync(output, "existing");
  result = run('source "$SCRIPT"; notarize_dmg_transform "$SOURCE" "$OUTPUT"', { SCRIPT: dmgScript, SOURCE: source, OUTPUT: output });
  expect(result.exitCode).not.toBe(0); expect(readFileSync(output, "utf8")).toBe("existing");
});

test("native directory rename is atomically no-clobber and never nests into a concurrent destination", () => {
  const root = fixture(); const helper = join(root, "atomic-rename");
  let result = run('cc -std=c11 -Wall -Wextra -Werror "$SOURCE" -o "$HELPER"', { SOURCE: renameSource, HELPER: helper });
  expect(result.exitCode).toBe(0);
  const source = join(root, "source"); const destination = join(root, "destination"); mkdirSync(source); writeFileSync(join(source, "ours"), "ours"); mkdirSync(destination); writeFileSync(join(destination, "theirs"), "theirs");
  result = run('"$HELPER" "$SOURCE_DIR" "$DESTINATION"', { HELPER: helper, SOURCE_DIR: source, DESTINATION: destination });
  expect(result.exitCode).not.toBe(0);
  expect(readFileSync(join(source, "ours"), "utf8")).toBe("ours");
  expect(readFileSync(join(destination, "theirs"), "utf8")).toBe("theirs");
  expect(existsSync(join(destination, "source"))).toBe(false);
});

test("cleanup quarantines only the exact promoted directory identity and preserves a replacement", () => {
  const root = fixture(); const helper = join(root, "atomic-rename");
  expect(run('cc -std=c11 -Wall -Wextra -Werror "$SOURCE" -o "$HELPER"', { SOURCE: renameSource, HELPER: helper }).exitCode).toBe(0);
  const privateSet = join(root, ".index-final-candidate.fixture"); const destination = join(root, "final");
  mkdirSync(privateSet); writeFileSync(join(privateSet, "ours"), "ours");
  const identity = `${statSync(privateSet).dev}:${statSync(privateSet).ino}`;
  expect(run('source "$SCRIPT"; atomic_rename_noreplace "$PRIVATE" "$DEST" "$HELPER"', { SCRIPT: orchestrator, PRIVATE: privateSet, DEST: destination, HELPER: helper }).exitCode).toBe(0);
  const displaced = join(root, "displaced");
  expect(run('mv "$DEST" "$DISPLACED"; mkdir "$DEST"; printf replacement >"$DEST/theirs"; source "$SCRIPT"; cleanup_promoted_release_set "$DEST" "$PRIVATE" "$IDENTITY" "$HELPER"', { SCRIPT: orchestrator, DEST: destination, PRIVATE: privateSet, DISPLACED: displaced, IDENTITY: identity, HELPER: helper }).exitCode).not.toBe(0);
  expect(readFileSync(join(destination, "theirs"), "utf8")).toBe("replacement");
  expect(readFileSync(join(displaced, "ours"), "utf8")).toBe("ours");
});

test("orchestrator uses native no-clobber promotion and identity-bound post-promotion cleanup", () => {
  const text = readFileSync(orchestrator, "utf8");
  expect(text).toContain("atomic-rename.c");
  expect(text).toContain("atomic_rename_noreplace");
  expect(text).toContain("cleanup_promoted_release_set");
  expect(text).toContain("candidate_inode_device");
  expect(text).not.toMatch(/\bmv\s+"\$private_set"\s+"\$destination"/);
  expect(text).not.toContain('rm -rf "$FINAL_DIRECTORY"');
});
