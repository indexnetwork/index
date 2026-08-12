import { expect, test } from 'bun:test';
import { access, chmod, lstat, mkdir, readlink, rm, writeFile } from 'node:fs/promises';

const macRoot = new URL('..', import.meta.url).pathname;
const scriptsRoot = new URL('.', import.meta.url).pathname;

function pngSize(bytes) {
  const magic = Buffer.from(bytes.subarray(0, 8)).toString('hex');
  expect(magic).toBe('89504e470d0a1a0a');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return { width: view.getUint32(16), height: view.getUint32(20) };
}

test('background generator emits 1x and 2x PNGs with expected dimensions', async () => {
  const work = `${Bun.env.TMPDIR ?? '/tmp'}/index-dmg-bg-${crypto.randomUUID()}`;
  await mkdir(work, { recursive: true });
  try {
    const compile = Bun.spawnSync(
      ['swiftc', '-O', '-o', `${work}/dmg-background`, new URL('./dmg-background.swift', import.meta.url).pathname],
      { cwd: scriptsRoot },
    );
    expect(compile.stderr.toString()).toBe('');
    expect(compile.exitCode).toBe(0);

    const run = Bun.spawnSync([`${work}/dmg-background`, work], { cwd: scriptsRoot });
    expect(run.exitCode).toBe(0);

    const oneX = await Bun.file(`${work}/dmg-background.png`).bytes();
    expect(pngSize(oneX)).toEqual({ width: 540, height: 380 });
    const twoX = await Bun.file(`${work}/dmg-background@2x.png`).bytes();
    expect(pngSize(twoX)).toEqual({ width: 1080, height: 760 });
  } finally {
    await rm(work, { recursive: true, force: true });
  }
  // Cold CI runners take >5s (the bun default) for the first swiftc invoke;
  // without this the timeout kills the compile and its late assertion error
  // cascades into an unrelated test failure.
}, 180_000);

const dmg = await Bun.file(new URL('./dmg.sh', import.meta.url)).text();

async function makeSignedApp() {
  const fixtureRoot = `${Bun.env.TMPDIR ?? '/tmp'}/index-dmg-${crypto.randomUUID()}`;
  const app = `${fixtureRoot}/index.app`;
  await mkdir(`${app}/Contents/MacOS`, { recursive: true });
  await writeFile(`${app}/Contents/MacOS/index`, '#!/bin/sh\nexit 0\n');
  await chmod(`${app}/Contents/MacOS/index`, 0o755);
  await writeFile(`${app}/Contents/Info.plist`, `<?xml version="1.0" encoding="UTF-8"?>
<plist version="1.0"><dict>
<key>CFBundleIdentifier</key><string>network.index.system6</string>
<key>CFBundleExecutable</key><string>index</string>
<key>CFBundlePackageType</key><string>APPL</string>
</dict></plist>`);
  const signed = Bun.spawnSync(['codesign', '--force', '--deep', '--sign', '-', app]);
  expect(signed.exitCode).toBe(0);
  return { root: fixtureRoot, app };
}

test('dmg.sh validates the stapled app before any packaging', () => {
  expect(dmg).toContain('codesign --verify --deep --strict');
  expect(dmg).toContain('xcrun stapler validate "$APP_PATH"');
  expect(dmg).toContain('spctl --assess --type execute');
  // Ordering (stapler validate before hdiutil create) is asserted in Task 3,
  // once the packaging pipeline exists.
  expect(dmg).not.toContain('--sign -');
});

test('dmg.sh notarizes and staples the DMG itself', () => {
  expect(dmg).toContain('xcrun notarytool submit "$DMG_PATH"');
  expect(dmg).toContain('--wait');
  expect(dmg).toContain('xcrun stapler staple "$DMG_PATH"');
  expect(dmg).toContain('xcrun stapler validate "$DMG_PATH"');
});

test('dmg.sh requires NOTARYTOOL_PROFILE unless SKIP_NOTARY=1 and cleans up on failure', () => {
  expect(dmg).toContain('NOTARYTOOL_PROFILE:?');
  expect(dmg).toContain('SKIP_NOTARY');
  expect(dmg).toContain('trap cleanup EXIT');
  expect(dmg).toContain('hdiutil detach');
  expect(dmg).toContain('rm -rf "$WORK"');
});

test('refuses to package an unnotarized app', async () => {
  const fixture = await makeSignedApp();
  try {
    const dmgPath = `${fixture.root}/should-not-exist.dmg`;
    const result = Bun.spawnSync(['bash', new URL('./dmg.sh', import.meta.url).pathname], {
      cwd: macRoot,
      env: {
        ...Bun.env,
        APP_PATH: fixture.app,
        DMG_PATH: dmgPath,
        SKIP_NOTARY: '1',
      },
    });
    expect(result.exitCode).not.toBe(0);
    // stapler validate reports its failure on stdout, codesign on stderr.
    expect(result.stdout.toString() + result.stderr.toString()).toMatch(/staple|validate/i);
    expect(await Bun.file(dmgPath).exists()).toBe(false);
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test('validation runs before any hdiutil packaging', () => {
  expect(dmg.indexOf('stapler validate "$APP_PATH"')).toBeLessThan(dmg.indexOf('hdiutil create'));
});

test('guards volume-name collisions and parses the real mountpoint', () => {
  // Fail-fast before attach when the volume name is already taken.
  const precheck = dmg.indexOf('[ -e "/Volumes/$VOLUME_NAME" ]');
  expect(precheck).toBeGreaterThan(-1);
  expect(precheck).toBeLessThan(dmg.indexOf('hdiutil attach'));
  // The real mountpoint comes from attach -plist, not an assumed path.
  expect(dmg).toContain('hdiutil attach "$RW_DMG" -readwrite -noverify -plist');
  expect(dmg).toContain('/usr/libexec/PlistBuddy');
  expect(dmg).not.toContain('MOUNT="/Volumes/$VOLUME_NAME"');
  // A mount anywhere but /Volumes/$VOLUME_NAME aborts (Finder styles by name).
  expect(dmg).toContain('volume-name race');
});

test('aborts safely when the volume-name race mounts us at a suffixed path', async () => {
  const fixture = await makeSignedApp();
  const fakeMount = `${fixture.root}/fake-volumes/Index-1`;
  const dmgPath = `${fixture.root}/Index.dmg`;
  // Same PATH-stub pattern as the e2e below (xcrun/spctl fake only the
  // notary-dependent checks), plus a minimal hdiutil stub whose `attach -plist`
  // reports a collision-style mountpoint under TMPDIR. Finder styling resolves
  // the disk by NAME, so a mount anywhere but /Volumes/$VOLUME_NAME means a
  // same-named foreign volume exists and dmg.sh must abort, not populate it.
  const stubBin = `${fixture.root}/bin`;
  await mkdir(stubBin, { recursive: true });
  await writeFile(`${stubBin}/xcrun`, '#!/bin/sh\nif [ "${1:-}" = "stapler" ]; then exit 0; fi\nexec /usr/bin/xcrun "$@"\n');
  await writeFile(`${stubBin}/spctl`, '#!/bin/sh\nexit 0\n');
  await writeFile(`${stubBin}/osascript`, '#!/bin/sh\nexit 0\n');
  await writeFile(`${stubBin}/hdiutil`, `#!/bin/sh
case "$1" in
  create|convert)
    out=""; prev=""
    for a in "$@"; do if [ "$prev" = "-o" ]; then out="$a"; fi; prev="$a"; done
    : > "$out"
    ;;
  attach)
    mkdir -p "$FAKE_MOUNT"
    printf '%s\n' '<?xml version="1.0" encoding="UTF-8"?>' \
      '<plist version="1.0"><dict><key>system-entities</key><array>' \
      '<dict><key>dev-entry</key><string>/dev/disk9</string></dict>' \
      "<dict><key>dev-entry</key><string>/dev/disk9s1</string><key>mount-point</key><string>$FAKE_MOUNT</string></dict>" \
      '</array></dict></plist>'
    ;;
  detach)
    exit 0
    ;;
  *)
    echo "stub hdiutil: unexpected subcommand $1" >&2
    exit 1
    ;;
esac
`);
  await chmod(`${stubBin}/xcrun`, 0o755);
  await chmod(`${stubBin}/spctl`, 0o755);
  await chmod(`${stubBin}/osascript`, 0o755);
  await chmod(`${stubBin}/hdiutil`, 0o755);
  try {
    const result = Bun.spawnSync(['bash', new URL('./dmg.sh', import.meta.url).pathname], {
      cwd: macRoot,
      env: {
        ...Bun.env,
        PATH: `${stubBin}:${Bun.env.PATH}`,
        FAKE_MOUNT: fakeMount,
        APP_PATH: fixture.app,
        DMG_PATH: dmgPath,
        SKIP_NOTARY: '1',
      },
    });
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr.toString()).toContain('volume-name race');
    // The foreign mountpoint must not be populated, and no DMG is produced.
    expect(await Bun.file(`${fakeMount}/index.app/Contents/MacOS/index`).exists()).toBe(false);
    expect(await Bun.file(dmgPath).exists()).toBe(false);
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
}, 180_000);

test('packages a signed fixture app into a styled DMG when SKIP_NOTARY=1', async () => {
  const fixture = await makeSignedApp();
  const mount = `${fixture.root}/mount`;
  await mkdir(mount, { recursive: true });
  const dmgPath = `${fixture.root}/Index.dmg`;
  // Plan defect fix (approved): an ad-hoc fixture can never pass dmg.sh's
  // notary-dependent validation (`xcrun stapler validate` needs a real Apple
  // ticket, `spctl --assess` rejects ad-hoc signatures), so the e2e stubs
  // those two commands via a PATH-prepended bin dir. The stubs fake ONLY the
  // notary-dependent checks; the packaging pipeline under test (hdiutil,
  // osascript, UDZO convert) runs for real. The refusal test above remains
  // the behavioral guard for the unstubbed validation gate.
  const stubBin = `${fixture.root}/bin`;
  await mkdir(stubBin, { recursive: true });
  await writeFile(`${stubBin}/xcrun`, '#!/bin/sh\nif [ "${1:-}" = "stapler" ]; then exit 0; fi\nexec /usr/bin/xcrun "$@"\n');
  await writeFile(`${stubBin}/spctl`, '#!/bin/sh\nexit 0\n');
  await chmod(`${stubBin}/xcrun`, 0o755);
  await chmod(`${stubBin}/spctl`, 0o755);
  try {
    const result = Bun.spawnSync(['bash', new URL('./dmg.sh', import.meta.url).pathname], {
      cwd: macRoot,
      env: {
        ...Bun.env,
        PATH: `${stubBin}:${Bun.env.PATH}`,
        APP_PATH: fixture.app,
        DMG_PATH: dmgPath,
        SKIP_NOTARY: '1',
      },
    });
    // codesign --verify logs to stderr even on success, so only the exit
    // code and the produced artifact are meaningful assertions here.
    expect(result.exitCode).toBe(0);
    expect(await Bun.file(dmgPath).exists()).toBe(true);

    const attach = Bun.spawnSync(['hdiutil', 'attach', dmgPath, '-readonly', '-nobrowse', '-mountpoint', mount]);
    expect(attach.exitCode).toBe(0);
    try {
      await access(`${mount}/index.app/Contents/MacOS/index`);
      const link = await lstat(`${mount}/Applications`);
      expect(link.isSymbolicLink()).toBe(true);
      expect(await readlink(`${mount}/Applications`)).toBe('/Applications');
      expect(pngSize(await Bun.file(`${mount}/.background/dmg-background.png`).bytes()))
        .toEqual({ width: 540, height: 380 });
      expect(pngSize(await Bun.file(`${mount}/.background/dmg-background@2x.png`).bytes()))
        .toEqual({ width: 1080, height: 760 });
    } finally {
      Bun.spawnSync(['hdiutil', 'detach', mount, '-force']);
    }
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
  // Packaging compiles the Swift generator and runs real hdiutil/osascript
  // work, far beyond bun's 5s default timeout.
}, 180_000);

const readme = await Bun.file(new URL('../README.md', import.meta.url)).text();
const workflow = await Bun.file(new URL('../../../.github/workflows/mac-app-build.yml', import.meta.url)).text();

test('README handoff documents the DMG packaging step', () => {
  expect(readme).toContain('./dmg.sh');
  expect(readme).toContain('xcrun stapler validate dist/Index.dmg');
});

test('macOS CI syntax-checks dmg.sh alongside the other scripts', () => {
  expect(workflow).toContain('bash -n scripts/build.sh scripts/link-host.sh scripts/provisioning-profile.sh scripts/notarize.sh scripts/dmg.sh');
});
