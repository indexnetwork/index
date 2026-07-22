import { afterEach, describe, expect, test } from 'bun:test';

import { DEFAULT_REPORTER_BRIEFING_TTL_MS, getReporterBriefingTtlMs, isAgentSurfaceEnabled } from '../agent-surface-feature';

const previous = process.env.WEB_AGENT_SURFACE_ENABLED;
const previousTtl = process.env.REPORTER_BRIEFING_TTL_MS;

afterEach(() => {
  if (previous === undefined) delete process.env.WEB_AGENT_SURFACE_ENABLED;
  else process.env.WEB_AGENT_SURFACE_ENABLED = previous;
  if (previousTtl === undefined) delete process.env.REPORTER_BRIEFING_TTL_MS;
  else process.env.REPORTER_BRIEFING_TTL_MS = previousTtl;
});

describe('WEB_AGENT_SURFACE_ENABLED', () => {
  test('is strict and default-off', () => {
    delete process.env.WEB_AGENT_SURFACE_ENABLED;
    expect(isAgentSurfaceEnabled()).toBe(false);

    process.env.WEB_AGENT_SURFACE_ENABLED = 'false';
    expect(isAgentSurfaceEnabled()).toBe(false);

    process.env.WEB_AGENT_SURFACE_ENABLED = 'TRUE';
    expect(isAgentSurfaceEnabled()).toBe(false);

    process.env.WEB_AGENT_SURFACE_ENABLED = 'true';
    expect(isAgentSurfaceEnabled()).toBe(true);
  });
});

describe('REPORTER_BRIEFING_TTL_MS', () => {
  test('defaults to 24 hours and accepts positive whole milliseconds', () => {
    delete process.env.REPORTER_BRIEFING_TTL_MS;
    expect(getReporterBriefingTtlMs()).toBe(DEFAULT_REPORTER_BRIEFING_TTL_MS);

    process.env.REPORTER_BRIEFING_TTL_MS = '60000';
    expect(getReporterBriefingTtlMs()).toBe(60_000);
  });

  test('falls back safely for direct imports with invalid values', () => {
    process.env.REPORTER_BRIEFING_TTL_MS = '0';
    expect(getReporterBriefingTtlMs()).toBe(DEFAULT_REPORTER_BRIEFING_TTL_MS);

    process.env.REPORTER_BRIEFING_TTL_MS = 'not-a-number';
    expect(getReporterBriefingTtlMs()).toBe(DEFAULT_REPORTER_BRIEFING_TTL_MS);
  });
});
