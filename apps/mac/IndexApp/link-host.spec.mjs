import { describe, expect, test } from 'bun:test';

const root = new URL('.', import.meta.url).pathname;
const helper = `${root}link-host.sh`;

function run(...args) {
  return Bun.spawnSync(['bash', helper, ...args]);
}

describe('mac link-host profile', () => {
  test.each(['index.network', 'dev.index.network'])('accepts %s', (host) => {
    const result = run('--resolve', host);
    expect(result.exitCode).toBe(0);
    expect(result.stdout.toString().trim()).toBe(host);
  });

  test.each(['', 'http://index.network', 'staging.index.network', 'index.network,evil.example'])('rejects invalid host %s', (host) => {
      expect(run('--resolve', host).exitCode).not.toBe(0);
    });

  test('renders only the selected associated domain', async () => {
    const destination = `${Bun.env.TMPDIR ?? '/tmp'}/index-link-host-${crypto.randomUUID()}.plist`;
    const result = run('--write-entitlements', 'dev.index.network', destination);
    expect(result.exitCode).toBe(0);
    expect(await Bun.file(destination).text()).toContain('<string>applinks:dev.index.network</string>');
    expect(await Bun.file(destination).text()).not.toContain('applinks:index.network</string>');
  });

  test('signed generation renders exactly the owner group and selected associated domain', async () => {
    const destination = `${Bun.env.TMPDIR ?? '/tmp'}/index-link-host-owner-${crypto.randomUUID()}.plist`;
    const group = 'TEAM123.network.index.system6.owner-credentials';
    const result = run('--write-entitlements', 'dev.index.network', destination, group);
    expect(result.exitCode).toBe(0);
    const artifact = await Bun.file(destination).text();
    expect(artifact).toContain(`<string>${group}</string>`);
    expect(artifact).toContain('<string>applinks:dev.index.network</string>');
    expect(artifact).not.toContain('network.index.connector.credentials');
    expect(artifact.match(/<key>/g)).toHaveLength(2);
  });

  test('rejects a non-owner Keychain group in app entitlement generation', () => {
    const destination = `${Bun.env.TMPDIR ?? '/tmp'}/index-link-host-wrong-${crypto.randomUUID()}.plist`;
    const result = run(
      '--write-entitlements', 'index.network', destination,
      'TEAM123.network.index.connector.credentials',
    );
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr.toString()).toContain('owner-credentials');
  });

  test('signed build refuses to default the app identifier prefix', () => {
    const result = Bun.spawnSync(['bash', `${root}build.sh`], {
      cwd: root,
      env: {
        ...Bun.env,
        CODESIGN_IDENTITY: 'Developer ID Application: fixture (TEAM123)',
        PROVISIONING_PROFILE: '/tmp/fixture.provisionprofile',
        INDEX_APP_IDENTIFIER_PREFIX: '',
      },
    });
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr.toString()).toContain('INDEX_APP_IDENTIFIER_PREFIX');
    expect(result.stdout.toString()).not.toContain('Assembling Resources/index.html');
  });

  test('build embeds the selected host and exact owner group before signing', async () => {
    const build = await Bun.file(`${root}build.sh`).text();
    expect(build).toContain('IndexDeepLinkHost');
    expect(build).toContain('PlistBuddy');
    expect(build).toContain('network.index.system6.owner-credentials');
    expect(build).toContain('write_associated_domains_entitlements "$LINK_HOST" "$ENTITLEMENTS" "$APP_KEYCHAIN_GROUP"');
  });
});
