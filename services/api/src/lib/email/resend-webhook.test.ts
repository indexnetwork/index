import { createHmac } from 'node:crypto';
import { describe, expect, test } from 'bun:test';

import { parseResendEvent, verifyResendWebhook } from './resend-webhook';

const key = Buffer.from('a-test-signing-key-of-some-length');
const secret = `whsec_${key.toString('base64')}`;
const body = JSON.stringify({ type: 'email.opened', created_at: '2026-10-17T09:30:00.000Z', data: { email_id: 'em_1', tags: { kind: 'morning_brief', user_id: 'user_1' } } });
const now = 1_790_000_000;

function headers(id: string, timestamp: number, payload: string, signingKey: Buffer = key): Headers {
  const signature = createHmac('sha256', signingKey).update(`${id}.${timestamp}.${payload}`).digest('base64');
  return new Headers({ 'svix-id': id, 'svix-timestamp': String(timestamp), 'svix-signature': `v1,${signature}` });
}

describe('verifyResendWebhook', () => {
  test('accepts a correctly signed body and returns the message id', () => {
    expect(verifyResendWebhook(secret, headers('msg_1', now, body), body, now)).toBe('msg_1');
  });

  test('accepts any matching signature when several are listed', () => {
    const valid = headers('msg_1', now, body);
    valid.set('svix-signature', `v1,AAAA ${valid.get('svix-signature')}`);
    expect(verifyResendWebhook(secret, valid, body, now)).toBe('msg_1');
  });

  test('rejects a changed body', () => {
    expect(verifyResendWebhook(secret, headers('msg_1', now, body), `${body} `, now)).toBeNull();
  });

  test('rejects a signature made with another key', () => {
    expect(verifyResendWebhook(secret, headers('msg_1', now, body, Buffer.from('another-key')), body, now)).toBeNull();
  });

  test('rejects a timestamp outside the tolerance', () => {
    expect(verifyResendWebhook(secret, headers('msg_1', now - 3600, body), body, now)).toBeNull();
  });

  test('rejects missing headers', () => {
    expect(verifyResendWebhook(secret, new Headers(), body, now)).toBeNull();
  });
});

describe('parseResendEvent', () => {
  test('keeps the type, email id, kind tag and event time', () => {
    expect(parseResendEvent(JSON.parse(body))).toEqual({
      type: 'opened',
      emailId: 'em_1',
      kind: 'morning_brief',
      userId: 'user_1',
      occurredAt: new Date('2026-10-17T09:30:00.000Z'),
    });
  });

  test('reads tags sent as a list', () => {
    const event = parseResendEvent({ type: 'email.clicked', created_at: '2026-10-17T10:00:00.000Z', data: { email_id: 'em_2', tags: [{ name: 'kind', value: 'message' }] } });
    expect(event?.kind).toBe('message');
  });

  test('leaves the user empty when the send had no user tag', () => {
    expect(parseResendEvent({ type: 'email.opened', created_at: '2026-10-17T10:00:00.000Z', data: { email_id: 'em_6', tags: { kind: 'message' } } })?.userId).toBeNull();
  });

  test('ignores email with no kind tag or an untracked kind', () => {
    expect(parseResendEvent({ type: 'email.sent', created_at: '2026-10-17T10:00:00.000Z', data: { email_id: 'em_3' } })).toBeNull();
    expect(parseResendEvent({ type: 'email.sent', created_at: '2026-10-17T10:00:00.000Z', data: { email_id: 'em_3', tags: { kind: 'magic_link' } } })).toBeNull();
  });

  test('ignores event types that are not tracked', () => {
    expect(parseResendEvent({ type: 'email.received', data: { email_id: 'em_4' } })).toBeNull();
    expect(parseResendEvent({ type: 'domain.updated', data: {} })).toBeNull();
    expect(parseResendEvent({ type: 'email.sent', data: {} })).toBeNull();
  });

  test('does not keep the recipient', () => {
    const event = parseResendEvent({ type: 'email.delivered', created_at: '2026-10-17T10:00:00.000Z', data: { email_id: 'em_5', tags: { kind: 'message' }, to: ['person@example.com'], subject: 'Hi' } });
    expect(JSON.stringify(event)).not.toContain('person@example.com');
  });
});
