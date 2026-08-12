import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';

const workflow = readFileSync(new URL('../../../.github/workflows/mac-dev-release.yml', import.meta.url), 'utf8');
const script = readFileSync(new URL('./dev-release.sh', import.meta.url), 'utf8');

const secretNames = [
  'INDEX_DEVELOPER_ID_CERTIFICATE_P12',
  'INDEX_DEVELOPER_ID_CERTIFICATE_PASSWORD',
  'INDEX_APP_PROVISIONING_PROFILE_BASE64',
  'INDEX_NOTARY_API_KEY_BASE64',
  'INDEX_NOTARY_KEY_ID',
  'INDEX_NOTARY_ISSUER_ID',
];

test('dev prerelease workflow is manual, protected, dev-only, and fail-closed', () => {
  expect(workflow).toContain('workflow_dispatch:');
  expect(workflow).toContain("if: github.ref == 'refs/heads/dev'");
  expect(workflow).toContain('environment: macos-dev-release');
  expect(workflow).toContain('cancel-in-progress: false');
  expect(workflow).toContain('api/native-api-bridge.spec.mjs');
  expect(workflow).not.toMatch(/pull_request:|push:/);
  for (const name of secretNames) {
    expect(workflow).toContain(`${name}: \${{ secrets.${name} }}`);
  }
});

test('release script pins dev endpoints and publishes only after notarization', () => {
  expect(script).toContain('https://protocol.dev.index.network');
  expect(script).toContain('https://dev.index.network');
  expect(script).toContain('validate_profile_plist');
  expect(script).toContain('network.index.system6.owner-credentials');
  expect(script.indexOf('scripts/notarize.sh')).toBeLessThan(script.indexOf('gh release create'));
  expect(script.indexOf('scripts/dmg.sh')).toBeLessThan(script.indexOf('gh release create'));
  expect(script.indexOf('gh release upload')).toBeLessThan(script.indexOf('--draft=false'));
  expect(script).toContain('--prerelease --latest=false');
  expect(script).toContain('security delete-keychain');
  expect(script).toContain('gh release delete');
  expect(script).not.toContain('set -x');
});
