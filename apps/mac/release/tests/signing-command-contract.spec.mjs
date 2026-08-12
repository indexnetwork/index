import { afterEach, expect, test } from "bun:test";
import { chmodSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const repoRoot = resolve(import.meta.dir, "../../../..");
const signPath = resolve(import.meta.dir, "../sign-bundles.sh");
const verifyPath = resolve(import.meta.dir, "../verify-signatures.sh");
const fixtures = [];

afterEach(() => fixtures.splice(0).forEach((path) => rmSync(path, { recursive: true, force: true })));

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "index-sign-command-"));
  fixtures.push(root);
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

const normalDetails = `Executable=/tmp/code
Identifier=network.index.helper
Format=Mach-O universal
CodeDirectory v=20500 size=123 flags=0x10000(runtime) hashes=1+7 location=embedded
Authority=Developer ID Application: Test (LMQ3XNXLAD)
Timestamp=Aug 9, 2026 at 12:34:56
TeamIdentifier=LMQ3XNXLAD
`;

function runtimeMock(root, { details = normalDetails, requirement } = {}) {
  const bin = join(root, "bin");
  mkdirSync(bin);
  executable(join(bin, "codesign"), `#!/usr/bin/env bash
case " $* " in
  *" -dvv "*) printf '%s' "$DETAILS" >&2 ;;
  *" -d -r- "*) printf '%s\\n' "$REQUIREMENT" >&2 ;;
  *" --entitlements :- "*) printf '%s' "$ENTITLEMENTS" ;;
esac
exit 0
`);
  return {
    PATH: `${bin}:${process.env.PATH}`,
    DETAILS: details,
    REQUIREMENT: requirement ?? 'designated => identifier "network.index.helper" and anchor apple generic and certificate leaf[subject.OU] = "LMQ3XNXLAD"',
    ENTITLEMENTS: "<?xml version=\"1.0\"?><plist version=\"1.0\"><dict/></plist>",
  };
}

test("accepts normal CodeDirectory runtime flags and a real secure timestamp", () => {
  const root = fixture();
  const result = run('source "$VERIFY"; verify_runtime_signature /tmp/code nested', {
    VERIFY: verifyPath,
    ...runtimeMock(root),
  });
  expect(result.exitCode).toBe(0);
});

test.each(["Timestamp=none", "Timestamp=", "Timestamp=not a timestamp"]) (
  "rejects non-secure timestamp output %s",
  (timestamp) => {
    const root = fixture();
    const details = normalDetails.replace(/Timestamp=.*/, timestamp);
    const result = run('source "$VERIFY"; verify_runtime_signature /tmp/code nested', {
      VERIFY: verifyPath,
      ...runtimeMock(root, { details }),
    });
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr.toString()).toContain("secure signing timestamp is missing or malformed");
  },
);

test("rejects requirement suffix injection instead of substring matching", () => {
  const root = fixture();
  const requirement = 'designated => identifier "network.index.helper" and anchor apple generic and certificate leaf[subject.OU] = "LMQ3XNXLAD" or true';
  const result = run('source "$VERIFY"; verify_runtime_signature /tmp/code nested', {
    VERIFY: verifyPath,
    ...runtimeMock(root, { requirement }),
  });
  expect(result.exitCode).not.toBe(0);
  expect(result.stderr.toString()).toContain("does not exactly match");
});

test("rejects malformed signed identifiers before requirement construction", () => {
  const root = fixture();
  const details = normalDetails.replace("Identifier=network.index.helper", 'Identifier=bad" or true');
  const result = run('source "$VERIFY"; verify_runtime_signature /tmp/code nested', {
    VERIFY: verifyPath,
    ...runtimeMock(root, { details }),
  });
  expect(result.exitCode).not.toBe(0);
  expect(result.stderr.toString()).toContain("identifier is invalid");
});

test("inventory fails closed when find emits a partial traversal then errors", () => {
  const root = fixture();
  const bin = join(root, "bin");
  mkdirSync(bin);
  executable(join(bin, "find"), `#!/usr/bin/env bash
printf '/tmp/code\\0'
printf 'injected find failure\\n' >&2
exit 73
`);
  executable(join(bin, "file"), "#!/usr/bin/env bash\nprintf 'Mach-O 64-bit executable\\n'\n");
  const result = run('source "$VERIFY"; callback() { :; }; for_each_macho /tmp/bundle callback', {
    VERIFY: verifyPath,
    PATH: `${bin}:${process.env.PATH}`,
  });
  expect(result.exitCode).not.toBe(0);
  expect(result.stderr.toString()).toContain("code inventory failed");
});

test("inside-out signing rejects partial producer output when find fails", () => {
  const root = fixture();
  const bin = join(root, "bin");
  mkdirSync(bin);
  executable(join(bin, "find"), `#!/usr/bin/env bash
printf '/tmp/code\\0'
exit 73
`);
  const result = run('source "$SIGN"; sign_inside_out /tmp/bundle identity', {
    SIGN: signPath,
    PATH: `${bin}:${process.env.PATH}`,
  });
  expect(result.exitCode).not.toBe(0);
  expect(result.stderr.toString()).toContain("code inventory failed");
});

test("inside-out signing preserves a Mach-O path containing a newline", async () => {
  const root = fixture();
  const bundle = join(root, "Bundle.app");
  const path = join(bundle, "Contents", "MacOS", "line\nbreak");
  mkdirSync(resolve(path, ".."), { recursive: true });
  writeFileSync(path, "binary");
  const log = join(root, "log");
  const result = run(`source "$SIGN"; file() { printf 'Mach-O 64-bit executable\\n'; }; sign_code_path() { printf '%s\\0' "$1" >> "$LOG"; }; sign_inside_out "$BUNDLE" identity`, {
    SIGN: signPath,
    BUNDLE: bundle,
    LOG: log,
  });
  expect(result.exitCode).toBe(0);
  expect(await Bun.file(log).text()).toBe(`${path}\0`);
});

test("root executable is signed with and verified against the exact root entitlements", () => {
  const root = fixture();
  const bundle = join(root, "Index.app");
  const executablePath = join(bundle, "Contents", "MacOS", "Index");
  mkdirSync(resolve(executablePath, ".."), { recursive: true });
  writeFileSync(executablePath, "binary");
  writeFileSync(join(bundle, "Contents", "Info.plist"), `<?xml version="1.0"?><plist version="1.0"><dict><key>CFBundleExecutable</key><string>Index</string></dict></plist>`);
  const log = join(root, "log");
  const result = run(`source "$SIGN"; plist_value() { printf 'Index\\n'; }; file() { printf 'Mach-O 64-bit executable\\n'; }; sign_code_path() { if [[ "$1" == "$SIGN_ROOT_EXECUTABLE" && "$SIGN_ROOT_ENTITLEMENTS" == "$ENTITLEMENTS" ]]; then printf exact > "$LOG"; fi; }; sign_inside_out "$BUNDLE" identity "$ENTITLEMENTS"`, {
    SIGN: signPath,
    BUNDLE: bundle,
    ENTITLEMENTS: join(root, "app.entitlements"),
    LOG: log,
  });
  expect(result.exitCode).toBe(0);
  expect(readFileSync(log, "utf8")).toBe("exact");
});

test("nested code entitlement verification rejects forbidden entitlements", () => {
  const root = fixture();
  const env = runtimeMock(root);
  env.ENTITLEMENTS = `<?xml version="1.0"?><plist version="1.0"><dict><key>com.apple.security.get-task-allow</key><true/></dict></plist>`;
  const result = run('source "$VERIFY"; validate_code_entitlements /tmp/code nested "" ""', {
    VERIFY: verifyPath,
    ...env,
  });
  expect(result.exitCode).not.toBe(0);
  expect(result.stderr.toString()).toContain("nested code must have no entitlements");
});

test("production app plist writer sets the exact runtime owner Keychain group", async () => {
  const root = fixture();
  const plist = join(root, "Info.plist");
  writeFileSync(plist, `<?xml version="1.0"?><plist version="1.0"><dict><key>IndexOwnerKeychainAccessGroup</key><string></string></dict></plist>`);
  const result = run('source "$SIGN"; write_runtime_keychain_group "$PLIST" "$GROUP"; verify_runtime_keychain_group "$PLIST" "$GROUP"', {
    SIGN: signPath,
    PLIST: plist,
    GROUP: "LMQ3XNXLAD.network.index.system6.owner-credentials",
    PLIST_BUDDY: "/nonexistent",
  });
  expect(result.exitCode).toBe(0);
  expect(await Bun.file(plist).text()).toContain("LMQ3XNXLAD.network.index.system6.owner-credentials");
});
