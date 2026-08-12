import { expect, test } from 'bun:test';
import { chmod, mkdir, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';

const root = new URL('..', import.meta.url).pathname;
const build = await Bun.file(new URL('./build.sh', import.meta.url)).text();
const notarize = await Bun.file(new URL('./notarize.sh', import.meta.url)).text();
const readme = await Bun.file(new URL('../README.md', import.meta.url)).text();
const workflow = await Bun.file(new URL('../../../.github/workflows/mac-app-build.yml', import.meta.url)).text();

async function makeSignedApp() {
  const fixtureRoot = `${Bun.env.TMPDIR ?? '/tmp'}/index-notary-${crypto.randomUUID()}`;
  const app = `${fixtureRoot}/Index.app`;
  await mkdir(`${app}/Contents/MacOS`, { recursive: true });
  await writeFile(`${app}/Contents/MacOS/index`, '#!/bin/sh\nexit 0\n');
  await chmod(`${app}/Contents/MacOS/index`, 0o755);
  await writeFile(`${app}/Contents/Info.plist`, `<?xml version="1.0" encoding="UTF-8"?>
<plist version="1.0"><dict>
<key>CFBundleIdentifier</key><string>network.index.system6</string>
<key>CFBundleExecutable</key><string>index</string>
<key>CFBundlePackageType</key><string>APPL</string>
<key>IndexDeepLinkHost</key><string>dev.index.network</string>
<key>IndexReleaseChannel</key><string>production</string>
<key>IndexDevelopmentBuild</key><false/>
<key>IndexReleaseVersion</key><string>1.0.0</string>
<key>IndexExpectedTeamID</key><string>LMQ3XNXLAD</string>
</dict></plist>`);
  const signed = Bun.spawnSync(['codesign', '--force', '--deep', '--sign', '-', app]);
  expect(signed.exitCode).toBe(0);
  return { root: fixtureRoot, app };
}

test('requested signing is hardened and cannot fall back to ad-hoc', () => {
  expect(build).toContain('--options runtime');
  expect(build).toContain('Developer ID Application:');
  expect(build).toMatch(/if \[ -n "\$\{IDENTITY\}" \]; then[\s\S]*exit 1/);
  expect(build).toMatch(/embed_provisioning_profile[\s\S]*codesign --force --deep --options runtime/);
  expect(build).not.toMatch(/if \[ -n "\$\{IDENTITY\}" \]; then[\s\S]*--sign -/);
});

test.skipIf(!existsSync('/usr/bin/codesign'))('legacy entrypoint refuses an app without an embedded profile before submission', async () => {
  const fixture = await makeSignedApp();
  try {
    const archive = `${fixture.root}/should-not-exist.zip`;
    const result = Bun.spawnSync(['bash', new URL('./notarize.sh', import.meta.url).pathname], {
      cwd: root,
      env: {
        ...Bun.env,
        APP_PATH: fixture.app,
        INDEX_RELEASE_VERSION: '1.0.0',
        NOTARYTOOL_PROFILE: 'unused-test-profile',
      },
    });
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr.toString()).toContain('embedded provisioning profile is missing');
    expect(await Bun.file(archive).exists()).toBe(false);
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test('macOS CI runs IndexApp shell tests', () => {
  expect(workflow).toContain('apps/mac/scripts/*.spec.mjs');
});

test('legacy notarization delegates to the exact production release pipeline', () => {
  expect(notarize).toContain('NOTARYTOOL_PROFILE');
  expect(notarize).toContain('notarize-bundle.sh');
  expect(notarize).toContain('create-dmg.sh');
  expect(notarize).toContain('notarize-dmg.sh');
  expect(notarize).toContain('verify-mounted-dmg.sh');
  expect(notarize).not.toContain('codesign --verify --deep');
});

test('documents the Developer ID dev handoff', () => {
  for (const required of [
    'INDEX_LINK_HOST=dev.index.network',
    "INDEX_APP_IDENTIFIER_PREFIX='TEAM123ABC.'",
    'CODESIGN_IDENTITY=',
    'PROVISIONING_PROFILE=',
    'NOTARYTOOL_PROFILE=',
    'embedded.provisionprofile',
    'Associated Domains enabled',
    'Developer ID provisioning profile',
    'No matching profile found',
    'https://dev.index.network/u/<id>/chat',
    'stays in the browser',
    'redacted',
  ]) expect(readme).toContain(required);
});
