import { afterEach, expect, test } from "bun:test";
import { chmodSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const repoRoot = resolve(import.meta.dir, "../../../..");
const releaseDir = resolve(import.meta.dir, "..");
const orchestratorPath = resolve(repoRoot, "apps/mac/IndexApp/notarize.sh");
const bundlePath = resolve(releaseDir, "notarize-bundle.sh");
const createPath = resolve(releaseDir, "create-dmg.sh");
const dmgPath = resolve(releaseDir, "notarize-dmg.sh");
const mountedPath = resolve(releaseDir, "verify-mounted-dmg.sh");
const fixtures = [];

afterEach(() => fixtures.splice(0).forEach((path) => rmSync(path, { recursive: true, force: true })));

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "index-package-command-"));
  fixtures.push(root);
  const helper = join(root, "zip.py");
  writeFileSync(helper, `import os,sys,zipfile\na=sys.argv[1]; z=zipfile.ZipFile(os.environ["ZIP_DEST"],"w")\nfor r,ds,fs in os.walk(a):\n for n in fs: z.write(os.path.join(r,n),os.path.relpath(os.path.join(r,n),os.path.dirname(a)))\nz.close()\n`);
  process.env.ZIP_HELPER = helper;
  return root;
}

function executable(path, contents) {
  writeFileSync(path, contents);
  chmodSync(path, 0o755);
}

function run(script, env = {}) {
  return Bun.spawnSync(["bash", "-c", script], {
    cwd: repoRoot,
    env: { ...process.env, ...env },
    stdout: "pipe",
    stderr: "pipe",
  });
}

function source(path) {
  return readFileSync(path, "utf8");
}

test("production orchestration notarizes both inner bundles before either exact DMG and verifies shipped bytes", () => {
  const script = source(orchestratorPath);
  const stapleApp = script.indexOf('notarize-bundle.sh" "$SIGNED_DIRECTORY/Index.app');
  const stapleConnector = script.indexOf('notarize-bundle.sh" "$SIGNED_DIRECTORY/IndexConnector.app');
  const createDmg = script.indexOf('create-dmg.sh"');
  const stapleDmg = script.indexOf('notarize_owned_candidate "$app_dmg"');
  expect(stapleApp).toBeGreaterThan(-1);
  expect(stapleConnector).toBeGreaterThan(stapleApp);
  expect(createDmg).toBeGreaterThan(stapleConnector);
  expect(stapleDmg).toBeGreaterThan(createDmg);
  expect(script).toContain("Index-macOS-${INDEX_RELEASE_VERSION}-universal.dmg");
  expect(script).toContain("IndexConnector-${INDEX_RELEASE_VERSION}-universal.dmg");
  expect(source(dmgPath)).toContain("verify-mounted-dmg.sh");
});

test.each([
  '{"status":"Rejected"}',
  '{"status":"accepted"}',
  '{"status":"Accepted with warnings"}',
  '{"status":"Accepted","extra":',
])("inner notary status is parsed exactly and %s prevents stapling", (notaryJson) => {
  const root = fixture();
  const bin = join(root, "bin");
  const app = join(root, "signed", "Index.app");
  const log = join(root, "commands");
  mkdirSync(join(app, "Contents"), { recursive: true });
  writeFileSync(join(app, "Contents", "Info.plist"), `<?xml version="1.0"?><plist version="1.0"><dict><key>IndexReleaseChannel</key><string>production</string><key>IndexDevelopmentBuild</key><false/><key>IndexReleaseVersion</key><string>1.0.0</string></dict></plist>`);
  mkdirSync(bin);
  executable(join(bin, "ditto"), '#!/usr/bin/env bash\nprintf "ditto\\n" >> "$LOG"\nif [[ " $* " == *" -x "* ]]; then cp -R "$APP" "${@: -1}/$(basename "$APP")"; else ZIP_DEST="${@: -1}" python3 "$ZIP_HELPER" "$APP"; fi\n');
  executable(join(bin, "xcrun"), `#!/usr/bin/env bash
printf '%s\\n' "$*" >> "$LOG"
if [[ "$1 $2" == "notarytool submit" ]]; then printf '%s\\n' "$NOTARY_JSON"; fi
`);
  executable(join(bin, "spctl"), '#!/usr/bin/env bash\nprintf "spctl:%s\\n" "$*" >> "$LOG"\n');
  const result = run('source "$SCRIPT"; uname() { printf "Darwin\\n"; }; verify_release_bundle_path() { printf "verify:%s\\n" "$1" >> "$LOG"; }; notarize_bundle_main "$APP"', {
    SCRIPT: bundlePath,
    APP: app,
    LOG: log,
    NOTARY_JSON: notaryJson,
    NOTARYTOOL_PROFILE: "provider-free-profile-name",
    TMPDIR: root,
    PATH: `${bin}:${process.env.PATH}`,
  });
  expect(result.exitCode).not.toBe(0);
  const commands = readFileSync(log, "utf8");
  expect(commands).toContain("notarytool submit");
  expect(commands).not.toContain("stapler staple");
  expect(result.stderr.toString()).toContain("not Accepted");
});

test("tool failure during inner submission prevents stapling", () => {
  const root = fixture();
  const bin = join(root, "bin");
  const app = join(root, "signed", "Index.app");
  const log = join(root, "commands");
  mkdirSync(join(app, "Contents"), { recursive: true });
  writeFileSync(join(app, "Contents", "Info.plist"), `<?xml version="1.0"?><plist version="1.0"><dict><key>IndexReleaseChannel</key><string>production</string><key>IndexDevelopmentBuild</key><false/><key>IndexReleaseVersion</key><string>1.0.0</string></dict></plist>`);
  mkdirSync(bin);
  executable(join(bin, "ditto"), '#!/usr/bin/env bash\nif [[ " $* " == *" -x "* ]]; then cp -R "$APP" "${@: -1}/$(basename "$APP")"; else ZIP_DEST="${@: -1}" python3 "$ZIP_HELPER" "$APP"; fi\n');
  executable(join(bin, "spctl"), "#!/usr/bin/env bash\nexit 0\n");
  executable(join(bin, "xcrun"), '#!/usr/bin/env bash\nprintf "%s\\n" "$*" >> "$LOG"\nexit 73\n');
  const result = run('source "$SCRIPT"; uname() { printf "Darwin\\n"; }; verify_release_bundle_path() { :; }; notarize_bundle_main "$APP"', {
    SCRIPT: bundlePath,
    APP: app,
    LOG: log,
    NOTARYTOOL_PROFILE: "provider-free-profile-name",
    TMPDIR: root,
    PATH: `${bin}:${process.env.PATH}`,
  });
  expect(result.exitCode).not.toBe(0);
  expect(readFileSync(log, "utf8")).not.toContain("stapler staple");
});

test("accepted inner submission verifies, staples, Gatekeeper-checks, and reverifies in order", () => {
  const root = fixture();
  const bin = join(root, "bin");
  const app = join(root, "signed", "IndexConnector.app");
  const log = join(root, "commands");
  mkdirSync(join(app, "Contents"), { recursive: true });
  writeFileSync(join(app, "Contents", "Info.plist"), `<?xml version="1.0"?><plist version="1.0"><dict><key>IndexReleaseChannel</key><string>production</string><key>IndexDevelopmentBuild</key><false/><key>IndexReleaseVersion</key><string>1.0.0</string></dict></plist>`);
  mkdirSync(bin);
  executable(join(bin, "ditto"), '#!/usr/bin/env bash\nprintf "archive\\n" >> "$LOG"\nif [[ " $* " == *" -x "* ]]; then cp -R "$APP" "${@: -1}/$(basename "$APP")"; else ZIP_DEST="${@: -1}" python3 "$ZIP_HELPER" "$APP"; fi\n');
  executable(join(bin, "xcrun"), `#!/usr/bin/env bash
printf '%s\\n' "$*" >> "$LOG"
if [[ "$1 $2" == "notarytool submit" ]]; then printf '{"status":"Accepted"}\\n'; fi
`);
  executable(join(bin, "spctl"), '#!/usr/bin/env bash\nprintf "spctl:%s\\n" "$*" >> "$LOG"\n');
  const result = run('source "$SCRIPT"; uname() { printf "Darwin\\n"; }; verify_release_bundle_path() { printf "verify:%s\\n" "$1" >> "$LOG"; }; notarize_bundle_main "$APP"', {
    SCRIPT: bundlePath,
    APP: app,
    LOG: log,
    NOTARYTOOL_PROFILE: "provider-free-profile-name",
    PATH: `${bin}:${process.env.PATH}`,
  });
  expect(result.exitCode).toBe(0);
  const lines = readFileSync(log, "utf8").trim().split("\n");
  expect(lines[0]).toStartWith("verify:");
  expect(lines.findIndex((line) => line.startsWith("notarytool submit"))).toBeGreaterThan(0);
  expect(lines.findIndex((line) => line.startsWith("stapler staple"))).toBeGreaterThan(lines.findIndex((line) => line.startsWith("notarytool submit")));
  expect(lines.findIndex((line) => line.startsWith("spctl:"))).toBeGreaterThan(lines.findIndex((line) => line.startsWith("stapler validate")));
  expect(lines.at(-1)).toStartWith("verify:");
});

test("DMG creation requires both sibling bundles already stapled and emits read-only exact output", () => {
  const root = fixture();
  const signed = join(root, "signed");
  const app = join(signed, "Index.app");
  const connector = join(signed, "IndexConnector.app");
  const output = join(root, "Index-macOS-1.0.0-universal.dmg");
  const bin = join(root, "bin");
  const log = join(root, "commands");
  mkdirSync(join(app, "Contents"), { recursive: true });
  mkdirSync(join(connector, "Contents"), { recursive: true });
  mkdirSync(bin);
  executable(join(bin, "xcrun"), '#!/usr/bin/env bash\nprintf "xcrun:%s\\n" "$*" >> "$LOG"\n');
  executable(join(bin, "spctl"), '#!/usr/bin/env bash\nprintf "spctl:%s\\n" "$*" >> "$LOG"\n');
  executable(join(bin, "ditto"), '#!/usr/bin/env bash\nprintf "ditto:%s\\n" "$*" >> "$LOG"\ncp -R "${@: -2:1}" "${@: -1}"\n');
  executable(join(bin, "hdiutil"), '#!/usr/bin/env bash\nprintf "hdiutil:%s\\n" "$*" >> "$LOG"\nprintf fixture > "${@: -1}"\n');
  executable(join(bin, "sw_vers"), '#!/usr/bin/env bash\n[[ "$1" == -productVersion ]] && printf "14.6\\n" || printf "23G80\\n"\n');
  const result = run('source "$SCRIPT"; uname() { printf "Darwin\\n"; }; verify_release_directory() { printf "verify:%s\\n" "$1" >> "$LOG"; }; verify_release_bundle_path() { printf "verify-stage:%s\\n" "$1" >> "$LOG"; }; create_dmg_main "$APP" "$OUTPUT"', {
    SCRIPT: createPath,
    APP: app,
    SOURCE_DATE_EPOCH: "0",
    OUTPUT: output,
    LOG: log,
    INDEX_RELEASE_VERSION: "1.0.0",
    INDEX_RELEASE_MACOS_VERSION: "14.6",
    INDEX_RELEASE_MACOS_BUILD: "23G80",
    PATH: `${bin}:${process.env.PATH}`,
  });
  expect(result.exitCode).toBe(0);
  const commands = readFileSync(log, "utf8");
  expect(commands.match(/stapler validate/g)?.length).toBe(2);
  expect(commands.match(/spctl:/g)?.length).toBe(2);
  expect(commands).toContain("-format UDRO");
  expect(commands.indexOf("verify:")).toBeLessThan(commands.indexOf("hdiutil:create"));
});

test("DMG rejection prevents stapling and mounted verification", () => {
  const root = fixture();
  const bin = join(root, "bin");
  const transaction = join(root, ".index-final-transaction.fixture");
  const dmg = join(transaction, "Index-macOS-1.0.0-universal.dmg");
  const log = join(root, "commands");
  mkdirSync(transaction, { mode: 0o700 });
  writeFileSync(dmg, "fixture");
  mkdirSync(bin);
  executable(join(bin, "codesign"), '#!/usr/bin/env bash\nprintf "codesign:%s\\n" "$*" >> "$LOG"\n');
  executable(join(bin, "security"), "#!/usr/bin/env bash\nexit 0\n");
  executable(join(bin, "hdiutil"), "#!/usr/bin/env bash\nexit 0\n");
  executable(join(bin, "xcrun"), `#!/usr/bin/env bash
printf '%s\\n' "$*" >> "$LOG"
if [[ "$1 $2" == "notarytool submit" ]]; then printf '{"status":"Invalid"}\\n'; fi
`);
  const result = run('source "$SCRIPT"; uname() { printf "Darwin\\n"; }; validate_production_identity() { :; }; verify_mounted_candidate() { :; }; verify_disk_image_signature() { :; }; sha256_dmg() { printf fixed; }; run_final_verification() { printf "mounted\\n" >> "$LOG"; }; notarize_dmg_internal "$DMG" "$DMG" "$(candidate_inode_device "$DMG")"', {
    SCRIPT: dmgPath,
    DMG: dmg,
    LOG: log,
    CODESIGN_IDENTITY: "Developer ID Application: Provider Free Fixture",
    NOTARYTOOL_PROFILE: "provider-free-profile-name",
    PATH: `${bin}:${process.env.PATH}`,
  });
  expect(result.exitCode).not.toBe(0);
  const commands = readFileSync(log, "utf8");
  expect(commands).not.toContain("stapler staple");
  expect(commands).not.toContain("mounted");
});

test("mounted verification uses the mounted bundle path and detaches after verification failure", () => {
  const root = fixture();
  const bin = join(root, "bin");
  const dmg = join(root, "Index-macOS-1.0.0-universal.dmg");
  const log = join(root, "commands");
  writeFileSync(dmg, "fixture");
  mkdirSync(bin);
  executable(join(bin, "hdiutil"), `#!/usr/bin/env bash
printf '%s\\n' "$*" >> "$LOG"
if [[ "$1" == attach ]]; then
  while [[ "$1" != -mountpoint ]]; do shift; done
  actual_mount="$2"
  mkdir -p "$actual_mount/Index.app/Contents"
  cat <<PLIST
<?xml version="1.0"?><plist version="1.0"><dict><key>system-entities</key><array><dict><key>mount-point</key><string>$actual_mount</string></dict></array></dict></plist>
PLIST
fi
`);
  const result = run('source "$SCRIPT"; uname() { printf "Darwin\\n"; }; verify_release_bundle_path() { printf "verified:%s\\n" "$1" >> "$LOG"; return 71; }; verify_mounted_dmg_main "$DMG"', {
    SCRIPT: mountedPath,
    DMG: dmg,
    LOG: log,
    TMPDIR: root,
    PATH: `${bin}:${process.env.PATH}`,
  });
  expect(result.exitCode).not.toBe(0);
  const commands = readFileSync(log, "utf8");
  expect(commands).toContain("attach -readonly -nobrowse -mountpoint");
  const verifiedPath = commands.match(/^verified:(.*\/Index\.app)$/m)?.[1];
  expect(verifiedPath).toBeTruthy();
  expect(verifiedPath).toContain(`${root}/index-dmg-mount.`);
  expect(commands).toContain(`detach ${verifiedPath.replace(/\/Index\.app$/, "")}`);
  expect(commands).not.toContain("dist/signed");
});
