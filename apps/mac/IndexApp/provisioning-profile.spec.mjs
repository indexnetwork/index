import { afterEach, describe, expect, test } from 'bun:test';
import { rm } from 'node:fs/promises';

const root = new URL('.', import.meta.url).pathname;
const helper = `${root}provisioning-profile.sh`;
const fixtures = [];

async function writeProfile(overrides = {}) {
  const path = `${Bun.env.TMPDIR ?? '/tmp'}/index-profile-${crypto.randomUUID()}.plist`;
  fixtures.push(path);
  const profile = {
    ExpirationDate: '2099-01-01T00:00:00Z',
    TeamIdentifier: ['TEAM123'],
    Entitlements: {
      'com.apple.application-identifier': 'TEAM123.network.index.system6',
      'com.apple.developer.team-identifier': 'TEAM123',
      'com.apple.developer.associated-domains': ['applinks:dev.index.network'],
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

function validate(path, team = 'TEAM123', bundle = 'network.index.system6', host = 'dev.index.network') {
  return Bun.spawnSync(['bash', helper, '--validate-plist', path, team, bundle, host]);
}

async function expectRejected(path, fragment, team, bundle, host) {
  const result = validate(path, team, bundle, host);
  expect(result.exitCode).not.toBe(0);
  expect(result.stderr.toString()).toContain(fragment);
}

afterEach(async () => Promise.all(fixtures.splice(0).map((path) => rm(path, { force: true }))));

describe('Developer ID provisioning profile validation', () => {
  test('accepts an exact associated domain', async () => {
    expect(validate(await writeProfile()).exitCode).toBe(0);
  });

  test.each(['*', 'applinks:*'])('accepts Apple wildcard authorization %s', async (domain) => {
    const path = await writeProfile({ Entitlements: {
      'com.apple.application-identifier': 'TEAM123.network.index.system6',
      'com.apple.developer.team-identifier': 'TEAM123',
      'com.apple.developer.associated-domains': [domain],
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
    }});
    await expectRejected(path, 'does not authorize the selected host');
  });
});
