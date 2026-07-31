import { afterEach, describe, expect, it } from 'bun:test';
import { discoveryAllowedTypes, discoveryIntentMatchingEnabled, discoveryProfileMatchingEnabled, discoveryProfileSource, resetDiscoveryEnvWarningsForTests } from '../discovery.env.js';

const VARS = ['DISCOVERY_ALLOWED_TYPES', 'DISCOVERY_PROFILE_SOURCE'] as const;
const saved: Record<string, string | undefined> = {};
for (const v of VARS) saved[v] = process.env[v];

afterEach(() => {
  for (const v of VARS) {
    if (saved[v] === undefined) delete process.env[v];
    else process.env[v] = saved[v];
  }
  resetDiscoveryEnvWarningsForTests();
});

describe('discoveryAllowedTypes', () => {
  it('defaults to intent+profile when unset', () => {
    delete process.env.DISCOVERY_ALLOWED_TYPES;
    expect(discoveryAllowedTypes()).toEqual(new Set(['intent', 'profile']));
    expect(discoveryIntentMatchingEnabled()).toBe(true);
    expect(discoveryProfileMatchingEnabled()).toBe(true);
  });

  it('defaults to intent+profile when empty', () => {
    process.env.DISCOVERY_ALLOWED_TYPES = '';
    expect(discoveryAllowedTypes()).toEqual(new Set(['intent', 'profile']));
  });

  it('parses intent-only', () => {
    process.env.DISCOVERY_ALLOWED_TYPES = 'intent';
    expect(discoveryIntentMatchingEnabled()).toBe(true);
    expect(discoveryProfileMatchingEnabled()).toBe(false);
  });

  it('parses profile-only', () => {
    process.env.DISCOVERY_ALLOWED_TYPES = 'profile';
    expect(discoveryIntentMatchingEnabled()).toBe(false);
    expect(discoveryProfileMatchingEnabled()).toBe(true);
  });

  it('normalizes case and whitespace', () => {
    process.env.DISCOVERY_ALLOWED_TYPES = ' Intent , PROFILE ';
    expect(discoveryAllowedTypes()).toEqual(new Set(['intent', 'profile']));
  });

  it('warns and ignores unknown tokens, keeping valid ones', () => {
    process.env.DISCOVERY_ALLOWED_TYPES = 'intent,foo';
    expect(discoveryAllowedTypes()).toEqual(new Set(['intent']));
  });

  it('treats premise/user_context tokens as unknown', () => {
    process.env.DISCOVERY_ALLOWED_TYPES = 'intent,premise,user_context';
    expect(discoveryAllowedTypes()).toEqual(new Set(['intent']));
  });

  it('falls back to both-allowed when no valid tokens remain', () => {
    process.env.DISCOVERY_ALLOWED_TYPES = 'foo,bar';
    expect(discoveryAllowedTypes()).toEqual(new Set(['intent', 'profile']));
  });
});

describe('discoveryProfileSource', () => {
  it('defaults to premise when unset or empty', () => {
    delete process.env.DISCOVERY_PROFILE_SOURCE;
    expect(discoveryProfileSource()).toBe('premise');
    process.env.DISCOVERY_PROFILE_SOURCE = '';
    expect(discoveryProfileSource()).toBe('premise');
  });

  it('parses user_context', () => {
    process.env.DISCOVERY_PROFILE_SOURCE = 'user_context';
    expect(discoveryProfileSource()).toBe('user_context');
  });

  it('normalizes case/whitespace and falls back to premise on garbage', () => {
    process.env.DISCOVERY_PROFILE_SOURCE = ' User_Context ';
    expect(discoveryProfileSource()).toBe('user_context');
    process.env.DISCOVERY_PROFILE_SOURCE = 'heavy';
    expect(discoveryProfileSource()).toBe('premise');
  });
});
