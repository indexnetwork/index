import { expect, test } from 'bun:test';
import { access, chmod, lstat, mkdir, readlink, rm, writeFile } from 'node:fs/promises';

const root = new URL('.', import.meta.url).pathname;

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
      { cwd: root },
    );
    expect(compile.stderr.toString()).toBe('');
    expect(compile.exitCode).toBe(0);

    const run = Bun.spawnSync([`${work}/dmg-background`, work], { cwd: root });
    expect(run.exitCode).toBe(0);

    const oneX = await Bun.file(`${work}/dmg-background.png`).bytes();
    expect(pngSize(oneX)).toEqual({ width: 540, height: 380 });
    const twoX = await Bun.file(`${work}/dmg-background@2x.png`).bytes();
    expect(pngSize(twoX)).toEqual({ width: 1080, height: 760 });
  } finally {
    await rm(work, { recursive: true, force: true });
  }
});

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
      cwd: root,
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
      cwd: root,
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
