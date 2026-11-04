/**
 * Contribution invites: pure rules for attribution and credit.
 *
 * No I/O here. Callers load the rows and pass them in, so every guard can be
 * tested without a database. See ISS-4 for the design.
 */

/** Credits one invitee can contribute: distinct counterparts, never decays. */
export const CREDIT_CAP_PER_INVITEE = 3;

/** Distinct members one credit lets a public intent reach. */
export const REACH_PER_CREDIT = 5;

/** Similarity cutoff (0..1) for suggesting imported contacts. Starting value. */
export const CONTACT_MATCH_MIN_SIMILARITY = 0.45;

export type AttributionRefusal = 'self_referral' | 'existing_account' | 'already_bound';

/**
 * Whether a new account may be attributed to an inviter. Called once, at the
 * account's first sign-in. Attribution is never changed afterwards.
 *
 * @param input - The invitee's state and the inviter named by the link.
 * @returns `ok`, or the reason the link is refused.
 */
export function decideAttribution(input: {
  inviteeId: string;
  inviterId: string;
  /** False for an account that already existed before this sign-in. */
  inviteeIsNewAccount: boolean;
  /** The invitee's inviter, if one was already bound. */
  existingInviterId: string | null;
}): { ok: true } | { ok: false; reason: AttributionRefusal } {
  if (input.inviteeId === input.inviterId) return { ok: false, reason: 'self_referral' };
  if (!input.inviteeIsNewAccount) return { ok: false, reason: 'existing_account' };
  if (input.existingInviterId) return { ok: false, reason: 'already_bound' };
  return { ok: true };
}

export type CreditSkip =
  | 'email_unverified'
  | 'no_inviter'
  | 'counterpart_is_inviter'
  | 'same_inviter'
  | 'counterpart_already_credited'
  | 'cap_reached';

/**
 * Whether an accepted opportunity between `invitee` and `counterpart` earns
 * credit for the invitee's direct inviter.
 *
 * @param input - Both parties' state, read inside the accepting transaction.
 * @returns `credit` with the inviter to credit, or the reason for no credit.
 */
export function decideCredit(input: {
  inviteeEmailVerified: boolean;
  /** The invitee's direct inviter, or null if the invitee was not invited. */
  inviteeInviterId: string | null;
  counterpartId: string;
  /** The counterpart's inviter, or null. */
  counterpartInviterId: string | null;
  /** True if this (inviter, invitee, counterpart) triple already has credit. */
  alreadyCredited: boolean;
  /** Distinct counterparts already credited for this invitee. */
  inviteeCreditCount: number;
}): { credit: true; inviterId: string } | { credit: false; reason: CreditSkip } {
  if (!input.inviteeEmailVerified) return { credit: false, reason: 'email_unverified' };
  if (!input.inviteeInviterId) return { credit: false, reason: 'no_inviter' };
  if (input.counterpartId === input.inviteeInviterId) return { credit: false, reason: 'counterpart_is_inviter' };
  if (input.counterpartInviterId && input.counterpartInviterId === input.inviteeInviterId) {
    return { credit: false, reason: 'same_inviter' };
  }
  if (input.alreadyCredited) return { credit: false, reason: 'counterpart_already_credited' };
  if (input.inviteeCreditCount >= CREDIT_CAP_PER_INVITEE) return { credit: false, reason: 'cap_reached' };
  return { credit: true, inviterId: input.inviteeInviterId };
}
