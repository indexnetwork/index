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

  test('build embeds the selected host before signing', async () => {
    const build = await Bun.file(`${root}build.sh`).text();
    expect(build).toContain('IndexDeepLinkHost');
    expect(build).toContain('PlistBuddy');
    expect(build).toContain('write_associated_domains_entitlements "$LINK_HOST"');
  });
});
