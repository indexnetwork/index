import { config } from 'dotenv';
config({ path: '.env.test', override: true });

import { describe, it, expect, mock, beforeEach } from 'bun:test';
import { handleIntentCreatedMaintenance, IntentEvents } from '../intent.event';

/**
 * Tests that IntentEvents hooks trigger maintenance for all lifecycle events.
 */
describe('IntentEvents maintenance hooks', () => {
  beforeEach(() => {
    // Reset to no-ops
    IntentEvents.onCreated = () => {};
    IntentEvents.onMaterialUpdated = async () => {};
    IntentEvents.onArchived = () => {};
  });

  it('onCreated can be assigned a handler', () => {
    const handler = mock(() => {});
    IntentEvents.onCreated = handler;
    IntentEvents.onCreated('intent-1', 'user-1');
    expect(handler).toHaveBeenCalledWith('intent-1', 'user-1');
  });

  it('create-time event wiring performs maintenance only; discovery belongs to post-HyDE', () => {
    const triggerMaintenance = mock((_userId: string, _reason: string) => {});

    handleIntentCreatedMaintenance('intent-1', 'user-1', triggerMaintenance);

    expect(triggerMaintenance).toHaveBeenCalledTimes(1);
    expect(triggerMaintenance).toHaveBeenCalledWith('user-1', 'intent-created');
  });

  it('onArchived can be assigned a handler', () => {
    const handler = mock(() => {});
    IntentEvents.onArchived = handler;
    IntentEvents.onArchived('intent-3', 'user-3');
    expect(handler).toHaveBeenCalledWith('intent-3', 'user-3');
  });

  it('material updates carry old and new fingerprints through an awaited hook', async () => {
    const handler = mock(async () => {});
    IntentEvents.onMaterialUpdated = handler;
    const event = {
      intentId: 'intent-1',
      userId: 'user-1',
      oldFingerprint: 'old',
      newFingerprint: 'new',
    };
    await IntentEvents.onMaterialUpdated(event);
    expect(handler).toHaveBeenCalledWith(event);
  });

  it('all event hooks exist on IntentEvents', () => {
    expect(IntentEvents).toHaveProperty('onCreated');
    expect(IntentEvents).toHaveProperty('onMaterialUpdated');
    expect(IntentEvents).toHaveProperty('onArchived');
    expect(typeof IntentEvents.onCreated).toBe('function');
    expect(typeof IntentEvents.onMaterialUpdated).toBe('function');
    expect(typeof IntentEvents.onArchived).toBe('function');
  });
});
