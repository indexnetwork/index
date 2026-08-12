import { afterEach, expect, test } from "bun:test";
import { chmodSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const repoRoot = resolve(import.meta.dir, "../../../..");
const releaseDir = resolve(import.meta.dir, "..");
const orchestratorPath = resolve(repoRoot, "apps/mac/scripts/notarize.sh");
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

function exactDetachArgument(commands) {
  const detachCommands = commands
    .split("\n")
    .map((line) => line.trim().split(/\s+/))
    .filter(([command]) => command === "detach");
  expect(detachCommands).toHaveLength(1);
  expect(detachCommands[0]).toHaveLength(2);
  return detachCommands[0][1].replaceAll("/private/var/", "/var/");
}

test("detach command proof rejects an additional bare detach invocation", () => {
  expect(() => exactDetachArgument("detach /var/folders/mount\ndetach\n")).toThrow();
});

test("production orchestration notarizes both inner bundles before either exact DMG and verifies shipped bytes", () => {
  const script = source(orchestratorPath);
  const stapleApp = script.indexOf('notarize-bundle.sh" "$SIGNED_DIRECTORY/Index.app');
  const stapleConnector = script.indexOf('notarize-bundle.sh" "$SIGNED_DIRECTORY/IndexConnector.app');
  const createDmg = script.indexOf('create-dmg.sh"');
  const stapleDmg = script.indexOf('notarize_dmg_transform "$app_source" "$app_dmg"');
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
    GITHUB_ACTIONS: "",
    PATH: `${bin}:${process.env.PATH}`,
  });
  expect(result.exitCode, result.stderr.toString()).toBe(0);
  const commands = readFileSync(log, "utf8");
  expect(commands.match(/stapler validate/g)?.length).toBe(2);
  expect(commands.match(/spctl:/g)?.length).toBe(2);
  expect(commands).toContain("-format UDRO");
  expect(commands.indexOf("verify:")).toBeLessThan(commands.indexOf("hdiutil:create"));
});

test("DMG rejection prevents stapling and mounted verification", () => {
  const root = fixture();
  const bin = join(root, "bin");
  const sourceTransaction = join(root, ".index-final-source.fixture");
  const transaction = join(root, ".index-final-candidate.fixture");
  const sourceDmg = join(sourceTransaction, "Index-macOS-1.0.0-universal.dmg");
  const dmg = join(transaction, "Index-macOS-1.0.0-universal.dmg");
  const log = join(root, "commands");
  mkdirSync(sourceTransaction, { mode: 0o700 });
  mkdirSync(transaction, { mode: 0o700 });
  writeFileSync(sourceDmg, "fixture");
  writeFileSync(`${sourceDmg}.reproducibility.txt`, "artifact.sha256=old\n");
  mkdirSync(bin);
  executable(join(bin, "codesign"), '#!/usr/bin/env bash\nprintf "codesign:%s\\n" "$*" >> "$LOG"\n');
  executable(join(bin, "security"), "#!/usr/bin/env bash\nexit 0\n");
  executable(join(bin, "hdiutil"), "#!/usr/bin/env bash\nexit 0\n");
  executable(join(bin, "xcrun"), `#!/usr/bin/env bash
printf '%s\\n' "$*" >> "$LOG"
if [[ "$1 $2" == "notarytool submit" ]]; then printf '{"status":"Invalid"}\\n'; fi
`);
  const result = run('source "$SCRIPT"; uname() { printf "Darwin\\n"; }; validate_production_identity() { :; }; verify_mounted_candidate() { :; }; verify_disk_image_signature() { :; }; run_final_verification() { printf "mounted\\n" >> "$LOG"; }; notarize_dmg_transform "$SOURCE_DMG" "$DMG"', {
    SCRIPT: dmgPath,
    SOURCE_DMG: sourceDmg,
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

function runMountedVerification({ attachStatus = 0, verifyStatus = 0, detachStatus = 0 } = {}) {
  const root = fixture();
  const bin = join(root, "bin");
  const dmg = join(root, "Index-macOS-1.0.0-universal.dmg");
  const log = join(root, "commands");
  writeFileSync(dmg, "fixture");
  mkdirSync(bin);
  executable(join(bin, "hdiutil"), `#!/usr/bin/env bash
printf '%s\\n' "$*" >> "$LOG"
if [[ "$1" == detach ]]; then
  [[ "$DETACH_STATUS" -eq 0 ]] && rm -rf "$2/Index.app"
  exit "$DETACH_STATUS"
fi
if [[ "$1" == attach ]]; then
  [[ "$ATTACH_STATUS" -eq 0 ]] || exit "$ATTACH_STATUS"
  while [[ "$1" != -mountpoint ]]; do shift; done
  actual_mount="$2"
  mkdir -p "$actual_mount/Index.app/Contents"
  cat <<PLIST
<?xml version="1.0"?><plist version="1.0"><dict><key>system-entities</key><array><dict><key>mount-point</key><string>$actual_mount</string></dict></array></dict></plist>
PLIST
fi
`);
  const result = run('source "$SCRIPT"; uname() { printf "Darwin\\n"; }; verify_release_bundle_path() { printf "verified:%s\\n" "$1" >> "$LOG"; return "$VERIFY_STATUS"; }; verify_mounted_dmg_main "$DMG"', {
    SCRIPT: mountedPath,
    DMG: dmg,
    LOG: log,
    TMPDIR: root,
    ATTACH_STATUS: String(attachStatus),
    VERIFY_STATUS: String(verifyStatus),
    DETACH_STATUS: String(detachStatus),
    PATH: `${bin}:${process.env.PATH}`,
  });
  return { result, commands: readFileSync(log, "utf8"), root };
}

test("mounted verification uses explicit handled-flow cleanup with shell-scoped fallback state", () => {
  const script = source(mountedPath);
  expect(script).toContain("verify_status=0");
  expect(script).toMatch(/if verify_release_bundle_path[\s\S]*else[\s\S]*verify_status=\$\?/);
  expect(script).toMatch(/trap - EXIT[\s\S]*cleanup \"\$verify_status\"/);
  expect(script).toContain("cleanup_done=0");
  expect(script).not.toMatch(/local .*mounted/);
});

test("mounted verification preserves status 71 and detaches exactly once after verification failure", () => {
  const { result, commands, root } = runMountedVerification({ verifyStatus: 71 });
  expect(result.exitCode).toBe(71);
  expect(commands).toContain("attach -readonly -nobrowse -mountpoint");
  const verifiedPath = commands.match(/^verified:(.*\/Index\.app)$/m)?.[1];
  expect(verifiedPath).toBeTruthy();
  expect(verifiedPath).toContain(`${root}/index-dmg-mount.`);
  const requestedMount = commands.match(/^attach .* -mountpoint (\S+) -plist /m)?.[1];
  expect(requestedMount).toBeTruthy();
  expect(exactDetachArgument(commands)).toBe(requestedMount.replaceAll("/private/var/", "/var/"));
  expect(commands).not.toContain("dist/signed");
});

test("mounted verification does not detach when attach fails", () => {
  const { result, commands } = runMountedVerification({ attachStatus: 72 });
  expect(result.exitCode).toBe(72);
  expect(commands.match(/^detach(?: |$)/gm) ?? []).toHaveLength(0);
  expect(commands).not.toContain("verified:");
});

test("mounted verification fails closed and detaches once when cleanup fails", () => {
  const { result, commands } = runMountedVerification({ detachStatus: 73 });
  expect(result.exitCode).toBe(1);
  exactDetachArgument(commands);
});

test("mounted verification succeeds and detaches exactly once", () => {
  const { result, commands } = runMountedVerification();
  expect(result.exitCode).toBe(0);
  exactDetachArgument(commands);
});
