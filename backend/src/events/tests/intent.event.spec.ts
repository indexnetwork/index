import { config } from 'dotenv';
config({ path: '.env.test', override: true });

import { describe, it, expect, mock, beforeEach } from 'bun:test';
import { IntentEvents } from '../intent.event';

/**
 * Tests that IntentEvents hooks trigger maintenance for all lifecycle events.
 */
describe('IntentEvents maintenance hooks', () => {
  beforeEach(() => {
    // Reset to no-ops
    IntentEvents.onCreated = () => {};
    IntentEvents.onUpdated = () => {};
    IntentEvents.onArchived = () => {};
  });

  it('onCreated can be assigned a handler', () => {
    const handler = mock(() => {});
    IntentEvents.onCreated = handler;
    IntentEvents.onCreated('intent-1', 'user-1');
    expect(handler).toHaveBeenCalledWith('intent-1', 'user-1');
  });

  it('onUpdated can be assigned a handler', () => {
    const handler = mock(() => {});
    IntentEvents.onUpdated = handler;
    IntentEvents.onUpdated('intent-2', 'user-2');
    expect(handler).toHaveBeenCalledWith('intent-2', 'user-2');
  });

  it('onArchived can be assigned a handler', () => {
    const handler = mock(() => {});
    IntentEvents.onArchived = handler;
    IntentEvents.onArchived('intent-3', 'user-3');
    expect(handler).toHaveBeenCalledWith('intent-3', 'user-3');
  });

  it('all three event hooks exist on IntentEvents', () => {
    expect(IntentEvents).toHaveProperty('onCreated');
    expect(IntentEvents).toHaveProperty('onUpdated');
    expect(IntentEvents).toHaveProperty('onArchived');
    expect(typeof IntentEvents.onCreated).toBe('function');
    expect(typeof IntentEvents.onUpdated).toBe('function');
    expect(typeof IntentEvents.onArchived).toBe('function');
  });
});
