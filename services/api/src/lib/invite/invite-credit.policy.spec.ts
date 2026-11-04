import { describe, expect, test } from 'bun:test';

import { CREDIT_CAP_PER_INVITEE, decideAttribution, decideCredit } from './invite-credit.policy';

const base = {
  inviteeEmailVerified: true,
  inviteeInviterId: 'alice',
  counterpartId: 'carol',
  counterpartInviterId: 'dave',
  alreadyCredited: false,
  inviteeCreditCount: 0,
};

describe('attribution at first sign-in', () => {
  const fresh = { inviteeId: 'bob', inviterId: 'alice', inviteeIsNewAccount: true, existingInviterId: null };

  test('a new account invited by someone else is attributed', () => {
    expect(decideAttribution(fresh)).toEqual({ ok: true });
  });

  test('self-referral is refused', () => {
    expect(decideAttribution({ ...fresh, inviterId: 'bob' })).toEqual({ ok: false, reason: 'self_referral' });
  });

  test('an existing account is never attributed', () => {
    expect(decideAttribution({ ...fresh, inviteeIsNewAccount: false })).toEqual({ ok: false, reason: 'existing_account' });
  });

  test('an already-bound invitee keeps the first inviter', () => {
    expect(decideAttribution({ ...fresh, existingInviterId: 'eve' })).toEqual({ ok: false, reason: 'already_bound' });
  });
});

describe('credit on accepted opportunity', () => {
  test('a verified invitee with a fresh counterpart earns credit for the inviter', () => {
    expect(decideCredit(base)).toEqual({ credit: true, inviterId: 'alice' });
  });

  test('unverified email earns nothing', () => {
    expect(decideCredit({ ...base, inviteeEmailVerified: false })).toEqual({ credit: false, reason: 'email_unverified' });
  });

  test('an invitee with no inviter earns nothing', () => {
    expect(decideCredit({ ...base, inviteeInviterId: null })).toEqual({ credit: false, reason: 'no_inviter' });
  });

  test('an opportunity between the invitee and their own inviter earns nothing', () => {
    expect(decideCredit({ ...base, counterpartId: 'alice' })).toEqual({ credit: false, reason: 'counterpart_is_inviter' });
  });

  test('two people invited by the same inviter earn nothing', () => {
    expect(decideCredit({ ...base, counterpartInviterId: 'alice' })).toEqual({ credit: false, reason: 'same_inviter' });
  });

  test('a repeated counterpart counts once', () => {
    expect(decideCredit({ ...base, alreadyCredited: true })).toEqual({ credit: false, reason: 'counterpart_already_credited' });
  });

  test('credit stops at the per-invitee cap', () => {
    expect(decideCredit({ ...base, inviteeCreditCount: CREDIT_CAP_PER_INVITEE })).toEqual({ credit: false, reason: 'cap_reached' });
    expect(decideCredit({ ...base, inviteeCreditCount: CREDIT_CAP_PER_INVITEE - 1 })).toEqual({ credit: true, inviterId: 'alice' });
  });
});
