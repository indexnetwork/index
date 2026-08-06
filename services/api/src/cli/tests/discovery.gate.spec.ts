import { describe, expect, it } from 'bun:test';

import { AB_SIDE_BRANCH_ENV, AbGateError, assertAbConfirmation, assertAbSideEnvironment } from '../discovery.gate';

const SIDE_A_URL = 'postgresql://evaluser:hunter2secret@ep-side-a-123456.eu-central-1.aws.neon.tech/protocol_eval';
const SIDE_B_URL = 'postgresql://evaluser:hunter2secret@ep-side-b-123456.eu-central-1.aws.neon.tech/protocol_eval';

const env = (overrides: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv => ({
  DISCOVERY_CONFIRM: '1',
  TEST_DATABASE_SAFE: '1',
  NEON_API_KEY: 'neon-api-key',
  DISCOVERY_TARGETS: '{"projectId":"p"}',
  DATABASE_URL: SIDE_A_URL,
  [AB_SIDE_BRANCH_ENV]: 'eval-ab-a',
  ...overrides,
});

describe('assertAbConfirmation', () => {
  it('accepts an explicitly attested run', () => {
    expect(() => assertAbConfirmation(env())).not.toThrow();
  });

  it('refuses without the confirm variable, naming it', () => {
    expect(() => assertAbConfirmation(env({ DISCOVERY_CONFIRM: undefined }))).toThrow(/set DISCOVERY_CONFIRM=1/);
  });

  it.each(['0', 'true', 'yes', ''])('refuses DISCOVERY_CONFIRM=%p, because only an exact 1 is consent', (value) => {
    expect(() => assertAbConfirmation(env({ DISCOVERY_CONFIRM: value }))).toThrow(/DISCOVERY_CONFIRM=1/);
  });

  it('refuses without the disposable-database marker', () => {
    expect(() => assertAbConfirmation(env({ TEST_DATABASE_SAFE: undefined }))).toThrow(/TEST_DATABASE_SAFE=1/);
  });

  it('refuses without the control-plane key, which every process needs to attest its targets', () => {
    expect(() => assertAbConfirmation(env({ NEON_API_KEY: undefined }))).toThrow(/NEON_API_KEY is required/);
    expect(() => assertAbConfirmation(env({ NEON_API_KEY: '' }))).toThrow(/NEON_API_KEY is required/);
  });

  it('refuses without a targets manifest, naming the variable rather than restating its contract', () => {
    expect(() => assertAbConfirmation(env({ DISCOVERY_TARGETS: undefined }))).toThrow(/DISCOVERY_TARGETS must declare/);
    expect(() => assertAbConfirmation(env({ DISCOVERY_TARGETS: '  ' }))).toThrow(/DISCOVERY_TARGETS must declare/);
  });

  it('raises a refusal the bootstrap is allowed to print', () => {
    expect(() => assertAbConfirmation({})).toThrow(AbGateError);
  });

  it('claims nothing about how many branches this run will touch', () => {
    // This gate runs before the argv is parsed, so it does not yet know whether
    // the run is a comparison (two branches, two children) or a single
    // configuration (one of each). Both of these messages said "both A/B
    // branches" / "the two designated A/B branches", which became false for half
    // the runs the harness accepts the moment the single shape landed — and a
    // count of branches is exactly the sort of claim an operator acts on, by
    // going to look at them.
    //
    // The other shape-dependent messages solve this by taking the shape as a
    // parameter (`abSpentMessage`); this one cannot, so it must not count.
    const counting = /\bboth\b|\btwo\b|\bpair\b/i;
    for (const key of ['NEON_API_KEY', 'DISCOVERY_TARGETS'] as const) {
      let message = '';
      try {
        assertAbConfirmation(env({ [key]: undefined }));
      } catch (error) {
        message = error instanceof Error ? error.message : String(error);
      }
      expect(message, `${key}: gate refusal must not be raised without a message`).not.toBe('');
      expect(message, `${key}: "${message}" counts branches this gate cannot know`).not.toMatch(counting);
    }
  });
});

describe('assertAbSideEnvironment', () => {
  it('accepts a side composed against its own designated A/B branch', () => {
    const resolved = assertAbSideEnvironment(env(), 'a');
    expect(resolved.branch).toBe('eval-ab-a');
    expect(resolved.databaseUrl.pathname).toBe('/protocol_eval');
  });

  it('applies the confirmation gate first, so an unconfirmed child never reaches a URL check', () => {
    expect(() => assertAbSideEnvironment(env({ DISCOVERY_CONFIRM: undefined }), 'a')).toThrow(/DISCOVERY_CONFIRM=1/);
  });

  it('refuses a missing or unparseable DATABASE_URL', () => {
    expect(() => assertAbSideEnvironment(env({ DATABASE_URL: undefined }), 'a')).toThrow(/valid Neon protocol_eval URL/);
    expect(() => assertAbSideEnvironment(env({ DATABASE_URL: 'not a url' }), 'a')).toThrow(/valid Neon protocol_eval URL/);
  });

  it('refuses a non-postgres URL', () => {
    expect(() => assertAbSideEnvironment(env({ DATABASE_URL: 'https://ep-side-a.neon.tech/protocol_eval' }), 'a'))
      .toThrow(/must use postgres/);
  });

  it('refuses a non-Neon host, naming only the host', () => {
    expect(() => assertAbSideEnvironment(env({ DATABASE_URL: 'postgresql://u:p@db.example.com/protocol_eval' }), 'a'))
      .toThrow(/Refusing non-Neon DATABASE_URL host: db.example.com/);
  });

  it('refuses any database other than protocol_eval', () => {
    expect(() => assertAbSideEnvironment(env({ DATABASE_URL: SIDE_A_URL.replace('/protocol_eval', '/index') }), 'a'))
      .toThrow(/must be exactly \/protocol_eval/);
  });

  it('refuses a port other than 5432', () => {
    expect(() => assertAbSideEnvironment(env({ DATABASE_URL: SIDE_A_URL.replace('.neon.tech', '.neon.tech:6543') }), 'a'))
      .toThrow(/port must be exactly 5432/);
  });

  it('refuses a missing branch label', () => {
    expect(() => assertAbSideEnvironment(env({ [AB_SIDE_BRANCH_ENV]: undefined }), 'a'))
      .toThrow(/DISCOVERY_SIDE_BRANCH must be exactly eval-ab-a/);
  });

  it('refuses a branch that is not a designated A/B branch', () => {
    for (const branch of ['dev', 'production', 'eval-discovery-base', 'eval-ab-a-backup']) {
      expect(() => assertAbSideEnvironment(env({ [AB_SIDE_BRANCH_ENV]: branch }), 'a')).toThrow(/must be exactly eval-ab-a/);
    }
  });

  it("refuses side b's branch under side a's flag, which would misattribute a whole side", () => {
    expect(() => assertAbSideEnvironment(env({ DATABASE_URL: SIDE_B_URL, [AB_SIDE_BRANCH_ENV]: 'eval-ab-b' }), 'a'))
      .toThrow(/must be exactly eval-ab-a for side a/);
  });

  it('accepts side b on its own branch', () => {
    expect(assertAbSideEnvironment(env({ DATABASE_URL: SIDE_B_URL, [AB_SIDE_BRANCH_ENV]: 'eval-ab-b' }), 'b').branch)
      .toBe('eval-ab-b');
  });

  it('never puts the DATABASE_URL password into a refusal', () => {
    for (const overrides of [
      { DATABASE_URL: SIDE_A_URL.replace('/protocol_eval', '/index') },
      { DATABASE_URL: SIDE_A_URL.replace('.neon.tech', '.example.com') },
      { DATABASE_URL: SIDE_A_URL.replace('.neon.tech', '.neon.tech:6543') },
      { [AB_SIDE_BRANCH_ENV]: 'dev' },
    ]) {
      const error = (() => {
        try {
          assertAbSideEnvironment(env(overrides), 'a');
          return null;
        } catch (caught) {
          return caught as Error;
        }
      })();
      expect(error).not.toBeNull();
      expect(error!.message).not.toContain('hunter2secret');
    }
  });
});
