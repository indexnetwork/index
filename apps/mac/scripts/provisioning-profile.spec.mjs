import { afterEach, describe, expect, test } from 'bun:test';
import { mkdir, rm, writeFile } from 'node:fs/promises';

const macRoot = new URL('..', import.meta.url).pathname;
const scriptsRoot = new URL('.', import.meta.url).pathname;
const build = `${scriptsRoot}build.sh`;
const helper = `${scriptsRoot}provisioning-profile.sh`;
const fixtures = [];
const ownerGroup = 'TEAM123.network.index.system6.owner-credentials';

test('Developer ID builds refuse a missing explicit provisioning profile before build work', () => {
  const result = Bun.spawnSync(['bash', build], {
    cwd: macRoot,
    env: {
      ...Bun.env,
      INDEX_LINK_HOST: 'dev.index.network',
      CODESIGN_IDENTITY: 'Developer ID Application: test identity (TEAM123)',
      PROVISIONING_PROFILE: '',
    },
  });
  expect(result.exitCode).not.toBe(0);
  expect(result.stderr.toString()).toContain('set PROVISIONING_PROFILE for Developer ID signing');
  expect(result.stdout.toString()).not.toContain('Assembling Resources/index.html');
});

async function writeProfile(overrides = {}) {
  const path = `${Bun.env.TMPDIR ?? '/tmp'}/index-profile-${crypto.randomUUID()}.plist`;
  fixtures.push(path);
  const profile = {
    ExpirationDate: '2099-01-01T00:00:00Z',
    TeamIdentifier: ['TEAM123'],
    ApplicationIdentifierPrefix: ['TEAM123'],
    Entitlements: {
      'com.apple.application-identifier': 'TEAM123.network.index.system6',
      'com.apple.developer.team-identifier': 'TEAM123',
      'com.apple.developer.associated-domains': ['applinks:dev.index.network'],
      'keychain-access-groups': [ownerGroup],
    },
    ...overrides,
  };
  const proc = Bun.spawnSync(['python3', '-c', `
import json, plistlib, sys
from datetime import datetime
value = json.loads(sys.argv[2])
value['ExpirationDate'] = datetime.fromisoformat(
    value['ExpirationDate'].replace('Z', '+00:00')
).replace(tzinfo=None)
with open(sys.argv[1], 'wb') as f: plistlib.dump(value, f)
`, path, JSON.stringify(profile)]);
  expect(proc.exitCode).toBe(0);
  return path;
}

function validate(
  path,
  team = 'TEAM123',
  bundle = 'network.index.system6',
  host = 'dev.index.network',
  expectedOwnerGroup = `${team}.${bundle}.owner-credentials`,
) {
  return Bun.spawnSync([
    'bash', helper, '--validate-plist',
    path, team, bundle, host, expectedOwnerGroup,
  ]);
}

async function expectRejected(path, fragment, team, bundle, host, expectedOwnerGroup) {
  const result = validate(path, team, bundle, host, expectedOwnerGroup);
  expect(result.exitCode).not.toBe(0);
  expect(result.stderr.toString()).toContain(fragment);
}

afterEach(async () => Promise.all(fixtures.splice(0).map((path) => rm(path, { force: true }))));

test('certificate lookup failure under inherited errexit reports the redacted diagnostic', async () => {
  const fixtureRoot = `${Bun.env.TMPDIR ?? '/tmp'}/index-profile-team-${crypto.randomUUID()}`;
  const profile = `${fixtureRoot}/input.provisionprofile`;
  const contents = `${fixtureRoot}/Contents`;
  try {
    await mkdir(contents, { recursive: true });
    await writeFile(profile, 'not secret profile material');

    const identity = 'Developer ID Application: SECRET PERSON (SECRETTEAM)';
    const result = Bun.spawnSync([
      'bash',
      '-c',
      'set -e; source "$1"; certificate_team_id() { return 1; }; embed_provisioning_profile "$2" "$3" "$4" network.index.system6 dev.index.network TEAM123.network.index.system6.owner-credentials',
      'test-shell',
      helper,
      profile,
      contents,
      identity,
    ]);

    expect(result.exitCode).not.toBe(0);
    expect(result.stderr.toString()).toContain('could not derive the signing team');
    expect(result.stderr.toString()).not.toContain(identity);
  } finally {
    await rm(fixtureRoot, { recursive: true, force: true });
  }
});

test('existing embedded profile reaches CMS decoding after temporary file creation', async () => {
  const fixtureRoot = `${Bun.env.TMPDIR ?? '/tmp'}/index-embedded-profile-${crypto.randomUUID()}`;
  const app = `${fixtureRoot}/index.app`;
  const marker = `${fixtureRoot}/security-called`;
  try {
    await mkdir(`${app}/Contents`, { recursive: true });
    await writeFile(`${app}/Contents/embedded.provisionprofile`, 'test profile placeholder');
    await writeFile(`${app}/Contents/Info.plist`, `<?xml version="1.0" encoding="UTF-8"?>
<plist version="1.0"><dict>
<key>CFBundleIdentifier</key><string>network.index.system6</string>
</dict></plist>`);

    const result = Bun.spawnSync([
      'bash',
      '-c',
      'set -e; source "$1"; mktemp() { case "$1" in *XXXXXX) /usr/bin/mktemp "$1" ;; *) return 1 ;; esac; }; codesign() { printf "TeamIdentifier=TEAM123\\n"; }; security() { printf "called\\n" > "$SECURITY_MARKER"; return 1; }; validate_embedded_profile "$2" dev.index.network',
      'test-shell',
      helper,
      app,
    ], {
      env: { ...Bun.env, SECURITY_MARKER: marker, PLIST_BUDDY: '/usr/bin/true' },
    });

    expect(result.exitCode).not.toBe(0);
    expect(result.stderr.toString()).toContain('could not be decoded');
    expect(await Bun.file(marker).exists()).toBe(true);
  } finally {
    await rm(fixtureRoot, { recursive: true, force: true });
  }
});

describe('Developer ID provisioning profile validation', () => {
  test('accepts an exact associated domain without stderr output', async () => {
    const result = validate(await writeProfile());
    expect(result.exitCode).toBe(0);
    expect(result.stderr.toString()).toBe('');
  });

  test.each(['*', 'applinks:*'])('accepts Apple wildcard authorization %s', async (domain) => {
    const path = await writeProfile({ Entitlements: {
      'com.apple.application-identifier': 'TEAM123.network.index.system6',
      'com.apple.developer.team-identifier': 'TEAM123',
      'com.apple.developer.associated-domains': [domain],
      'keychain-access-groups': [ownerGroup],
    }});
    expect(validate(path).exitCode).toBe(0);
  });

  test('accepts Apple scalar wildcard authorization', async () => {
    const path = await writeProfile({ Entitlements: {
      'com.apple.application-identifier': 'TEAM123.network.index.system6',
      'com.apple.developer.team-identifier': 'TEAM123',
      'com.apple.developer.associated-domains': '*',
      'keychain-access-groups': [ownerGroup],
    }});
    expect(validate(path).exitCode).toBe(0);
  });

  test('rejects an expired profile', async () => {
    await expectRejected(await writeProfile({ ExpirationDate: '2020-01-01T00:00:00Z' }), 'is expired');
  });

  test('rejects a wrong team', async () => {
    await expectRejected(await writeProfile(), 'team does not match', 'OTHERTEAM');
  });

  test('rejects a wrong application identifier', async () => {
    await expectRejected(await writeProfile(), 'application identifier does not match', 'TEAM123', 'network.index.other');
  });

  test('rejects a wrong profile application identifier prefix', async () => {
    await expectRejected(
      await writeProfile({ ApplicationIdentifierPrefix: ['WRONGTEAM'] }),
      'application identifier prefix does not match',
    );
  });

  test('rejects a missing associated-domains authorization', async () => {
    const path = await writeProfile({ Entitlements: {
      'com.apple.application-identifier': 'TEAM123.network.index.system6',
      'com.apple.developer.team-identifier': 'TEAM123',
    }});
    await expectRejected(path, 'does not authorize Associated Domains');
  });

  test('rejects a different associated domain', async () => {
    const path = await writeProfile({ Entitlements: {
      'com.apple.application-identifier': 'TEAM123.network.index.system6',
      'com.apple.developer.team-identifier': 'TEAM123',
      'com.apple.developer.associated-domains': ['applinks:index.network'],
      'keychain-access-groups': [ownerGroup],
    }});
    await expectRejected(path, 'does not authorize the selected host');
  });

  test('rejects a missing owner Keychain group', async () => {
    const path = await writeProfile({ Entitlements: {
      'com.apple.application-identifier': 'TEAM123.network.index.system6',
      'com.apple.developer.team-identifier': 'TEAM123',
      'com.apple.developer.associated-domains': ['applinks:dev.index.network'],
    }});
    await expectRejected(path, 'does not authorize exactly the owner Keychain group');
  });

  test('rejects wildcard and mismatched Keychain groups', async () => {
    for (const group of ['TEAM123.*', 'TEAM123.network.index.connector.credentials']) {
      const path = await writeProfile({ Entitlements: {
        'com.apple.application-identifier': 'TEAM123.network.index.system6',
        'com.apple.developer.team-identifier': 'TEAM123',
        'com.apple.developer.associated-domains': ['applinks:dev.index.network'],
        'keychain-access-groups': [group],
      }});
      await expectRejected(path, 'does not authorize exactly the owner Keychain group');
    }
  });

  test('rejects an expected owner group with the wrong identifier prefix', async () => {
    await expectRejected(
      await writeProfile(),
      'owner Keychain group does not match the signing Team and bundle',
      'TEAM123',
      'network.index.system6',
      'dev.index.network',
      'WRONGTEAM.network.index.system6.owner-credentials',
    );
  });
});

describe('signed entitlement validation', () => {
  async function writeSignedEntitlements(
    groups = [ownerGroup],
    domains = ['applinks:dev.index.network'],
  ) {
    const path = `${Bun.env.TMPDIR ?? '/tmp'}/index-signed-entitlements-${crypto.randomUUID()}.plist`;
    fixtures.push(path);
    const value = {
      'com.apple.developer.associated-domains': domains,
      'keychain-access-groups': groups,
    };
    const proc = Bun.spawnSync(['python3', '-c', `
import json, plistlib, sys
with open(sys.argv[1], 'wb') as f: plistlib.dump(json.loads(sys.argv[2]), f)
`, path, JSON.stringify(value)]);
    expect(proc.exitCode).toBe(0);
    return path;
  }

  function validateSigned(path) {
    return Bun.spawnSync([
      'bash', helper, '--validate-signed-entitlements',
      path, 'dev.index.network', ownerGroup,
    ]);
  }

  test('accepts exactly the owner group and selected associated domain', async () => {
    const result = validateSigned(await writeSignedEntitlements());
    expect(result.exitCode).toBe(0);
    expect(result.stderr.toString()).toBe('');
  });

  test('preserves exact signed Associated Domains validation', async () => {
    const result = validateSigned(await writeSignedEntitlements(
      [ownerGroup],
      ['applinks:index.network'],
    ));
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr.toString()).toContain('does not match the signed Associated Domains entitlement');
  });

  test('rejects missing, wildcard, mismatched, or additional signed Keychain groups', async () => {
    for (const groups of [
      [],
      ['TEAM123.*'],
      ['TEAM123.network.index.connector.credentials'],
      [ownerGroup, 'TEAM123.network.index.connector.credentials'],
    ]) {
      const result = validateSigned(await writeSignedEntitlements(groups));
      expect(result.exitCode).not.toBe(0);
      expect(result.stderr.toString()).toContain('does not match the signed owner Keychain entitlement');
    }
  });
});
