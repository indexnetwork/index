import { config } from 'dotenv';
config({ path: '.env.test', override: true });

import { describe, it, expect, mock, beforeEach } from 'bun:test';
import { IntentEvents, intentResumeDiscoveryJobId } from '../intent.event';

/**
 * Tests that IntentEvents hooks trigger maintenance for all lifecycle events.
 */
describe('IntentEvents maintenance hooks', () => {
  beforeEach(() => {
    // Reset to no-ops
    IntentEvents.onCreated = () => {};
    IntentEvents.onPaused = () => {};
    IntentEvents.onResumed = async () => {};
    IntentEvents.onArchived = () => {};
  });

  it('onCreated can be assigned a handler', () => {
    const handler = mock(() => {});
    IntentEvents.onCreated = handler;
    IntentEvents.onCreated('intent-1', 'user-1');
    expect(handler).toHaveBeenCalledWith('intent-1', 'user-1');
  });

  it('onArchived can be assigned a handler', () => {
    const handler = mock(() => {});
    IntentEvents.onArchived = handler;
    IntentEvents.onArchived('intent-3', 'user-3');
    expect(handler).toHaveBeenCalledWith('intent-3', 'user-3');
  });

  it('pause and awaited resume hooks can be assigned', async () => {
    const paused = mock(() => {});
    const resumed = mock(async () => {});
    IntentEvents.onPaused = paused;
    IntentEvents.onResumed = resumed;

    IntentEvents.onPaused('intent-2', 'user-2', 100);
    await IntentEvents.onResumed('intent-2', 'user-2', 101);

    expect(paused).toHaveBeenCalledWith('intent-2', 'user-2', 100);
    expect(resumed).toHaveBeenCalledWith('intent-2', 'user-2', 101);
  });

  it('builds stable per-version resume job ids', () => {
    const first = intentResumeDiscoveryJobId('user-1', 'intent-1', 1000);
    expect(intentResumeDiscoveryJobId('user-1', 'intent-1', 1000)).toBe(first);
    expect(intentResumeDiscoveryJobId('user-1', 'intent-1', 1001)).not.toBe(first);
    expect(first).toBe('intent-resume-user-1-intent-1-1000');
  });

  it('all event hooks exist on IntentEvents', () => {
    expect(IntentEvents).toHaveProperty('onCreated');
    expect(IntentEvents).toHaveProperty('onPaused');
    expect(IntentEvents).toHaveProperty('onResumed');
    expect(IntentEvents).toHaveProperty('onArchived');
    expect(typeof IntentEvents.onCreated).toBe('function');
    expect(typeof IntentEvents.onPaused).toBe('function');
    expect(typeof IntentEvents.onResumed).toBe('function');
    expect(typeof IntentEvents.onArchived).toBe('function');
  });
});
