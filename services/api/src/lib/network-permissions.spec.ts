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
      allowGuestVibeCheck: true,
      contextInjection: { discovery: true },
    });
  });

  it('uses safe defaults for missing permissions', () => {
    expect(toPublicNetworkPermissions(null)).toEqual({
      joinPolicy: 'invite_only',
      invitationLink: null,
      allowGuestVibeCheck: false,
    });
  });
});
