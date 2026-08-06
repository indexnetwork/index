import type { NetworkPermissionsState } from '../schemas/database.schema';

/**
 * Project stored network permission JSON to the supported public contract.
 * Unknown and retired keys remain stored but are never returned to clients.
 */
export function toPublicNetworkPermissions(value: unknown): NetworkPermissionsState {
  const stored = value && typeof value === 'object'
    ? value as Partial<NetworkPermissionsState>
    : {};
  return {
    joinPolicy: stored.joinPolicy === 'anyone' ? 'anyone' : 'invite_only',
    invitationLink: stored.invitationLink ?? null,
    allowGuestVibeCheck: stored.allowGuestVibeCheck === true,
    ...(stored.contextInjection !== undefined
      ? { contextInjection: stored.contextInjection }
      : {}),
  };
}
