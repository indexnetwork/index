import { describe, expect, test } from 'bun:test';

import { LIFECYCLE_EVENT_TYPES, parseClientEvent } from './opportunity-event.policy';

describe('client opportunity events', () => {
  test('any non-lifecycle type is accepted, with or without context', () => {
    expect(parseClientEvent({ type: 'met' })).toEqual({ ok: true, event: { type: 'met', data: null } });
    expect(parseClientEvent({ type: 'rolodex.tagged', data: { tags: ['investor'] } })).toEqual({
      ok: true,
      event: { type: 'rolodex.tagged', data: { tags: ['investor'] } },
    });
  });

  test('free-form survey context is kept as sent', () => {
    const data = { question: 'This connection was really valuable to me.', answer: 'strongly_agree', nested: { a: [1, 2] } };
    const parsed = parseClientEvent({ type: 'survey', data });
    expect(parsed.ok && parsed.event.data).toEqual(data);
  });

  test('every lifecycle type is refused', () => {
    for (const type of LIFECYCLE_EVENT_TYPES) {
      expect(parseClientEvent({ type }).ok).toBe(false);
    }
  });

  test('a missing, empty or overlong type is refused', () => {
    expect(parseClientEvent({}).ok).toBe(false);
    expect(parseClientEvent({ type: '' }).ok).toBe(false);
    expect(parseClientEvent({ type: '   ' }).ok).toBe(false);
    expect(parseClientEvent({ type: 42 }).ok).toBe(false);
    expect(parseClientEvent({ type: 'x'.repeat(65) }).ok).toBe(false);
    expect(parseClientEvent({ type: 'x'.repeat(64) }).ok).toBe(true);
  });

  test('data that is not a plain object is refused', () => {
    expect(parseClientEvent({ type: 'met', data: 'hello' }).ok).toBe(false);
    expect(parseClientEvent({ type: 'met', data: [1, 2] }).ok).toBe(false);
    expect(parseClientEvent({ type: 'met', data: 3 }).ok).toBe(false);
  });

  test('a body that is not an object is refused', () => {
    expect(parseClientEvent(null).ok).toBe(false);
    expect(parseClientEvent([{ type: 'met' }]).ok).toBe(false);
  });

  test('the lifecycle list covers every type the status fold reads', () => {
    expect([...LIFECYCLE_EVENT_TYPES].sort()).toEqual(['agreed', 'committed', 'declined', 'expired', 'opened']);
  });
});
