import { expect, test } from 'bun:test';
import { chmod, mkdir, rm, writeFile } from 'node:fs/promises';

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
