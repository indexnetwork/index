import { afterEach, describe, expect, test } from 'bun:test';

import { isAgentSurfaceEnabled } from '../agent-surface-feature';

const previous = process.env.WEB_AGENT_SURFACE_ENABLED;

afterEach(() => {
  if (previous === undefined) delete process.env.WEB_AGENT_SURFACE_ENABLED;
  else process.env.WEB_AGENT_SURFACE_ENABLED = previous;
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
