import { describe, expect, it } from 'bun:test';

import { toPublicNetworkPermissions } from './network-permissions';

describe('toPublicNetworkPermissions', () => {
  it('omits retired and unknown stored keys', () => {
    expect(toPublicNetworkPermissions({
      joinPolicy: 'anyone',
      invitationLink: { code: 'invite' },
      allowGuestVibeCheck: true,
      contextInjection: { discovery: true },
      profileEnrichment: 'consent_required',
      futureKey: 'stored-only',
    })).toEqual({
      joinPolicy: 'anyone',
      invitationLink: { code: 'invite' },
      contextInjection: { discovery: true },
    });
  });

  it('uses safe defaults for missing permissions', () => {
    expect(toPublicNetworkPermissions(null)).toEqual({
      joinPolicy: 'invite_only',
      invitationLink: null,
    });
  });

  it('defaults malformed nested permission values', () => {
    expect(toPublicNetworkPermissions({
      invitationLink: { code: 42 },
      contextInjection: { discovery: 'yes' },
    })).toEqual({
      joinPolicy: 'invite_only',
      invitationLink: null,
    });
  });

  it('reconstructs valid nested permissions without unknown nested keys', () => {
    expect(toPublicNetworkPermissions({
      invitationLink: { code: 'invite', internal: 'stored-only' },
      contextInjection: { discovery: false, internal: 'stored-only' },
    })).toEqual({
      joinPolicy: 'invite_only',
      invitationLink: { code: 'invite' },
      contextInjection: { discovery: false },
    });
  });
});
