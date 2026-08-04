import { expect, test } from 'bun:test';

const build = await Bun.file(new URL('./build.sh', import.meta.url)).text();
const notarize = await Bun.file(new URL('./notarize.sh', import.meta.url)).text();
const readme = await Bun.file(new URL('../README.md', import.meta.url)).text();

test('requested signing is hardened and cannot fall back to ad-hoc', () => {
  expect(build).toContain('--options runtime');
  expect(build).toContain('Developer ID Application:');
  expect(build).toMatch(/if \[ -n "\$\{IDENTITY\}" \]; then[\s\S]*exit 1/);
  expect(build).not.toMatch(/if \[ -n "\$\{IDENTITY\}" \]; then[\s\S]*--sign -/);
});

test('notarization waits, staples, validates and assesses', () => {
  expect(notarize).toContain('NOTARYTOOL_PROFILE');
  expect(notarize).toContain('xcrun notarytool submit');
  expect(notarize).toContain('--wait');
  expect(notarize).toContain('xcrun stapler staple');
  expect(notarize).toContain('xcrun stapler validate');
  expect(notarize).toContain('spctl --assess --type execute');
});

test('documents the Developer ID dev handoff', () => {
  for (const required of [
    'INDEX_LINK_HOST=dev.index.network',
    'CODESIGN_IDENTITY=',
    'NOTARYTOOL_PROFILE=',
    'https://dev.index.network/u/<id>/chat',
    'stays in the browser',
    'redacted',
  ]) expect(readme).toContain(required);
});
