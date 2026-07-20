import { afterEach, describe, expect, test } from 'bun:test';

import { isWebSignalAgentEnabled } from '../signal-feature';

const previous = process.env.WEB_SIGNAL_AGENT_ENABLED;

afterEach(() => {
  if (previous === undefined) delete process.env.WEB_SIGNAL_AGENT_ENABLED;
  else process.env.WEB_SIGNAL_AGENT_ENABLED = previous;
});

describe('WEB_SIGNAL_AGENT_ENABLED', () => {
  test('is strict and default-off', () => {
    delete process.env.WEB_SIGNAL_AGENT_ENABLED;
    expect(isWebSignalAgentEnabled()).toBe(false);

    process.env.WEB_SIGNAL_AGENT_ENABLED = 'false';
    expect(isWebSignalAgentEnabled()).toBe(false);

    process.env.WEB_SIGNAL_AGENT_ENABLED = 'TRUE';
    expect(isWebSignalAgentEnabled()).toBe(false);

    process.env.WEB_SIGNAL_AGENT_ENABLED = 'true';
    expect(isWebSignalAgentEnabled()).toBe(true);
  });
});
