import type { NetworkPermissionsState } from '../schemas/database.schema';

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Project stored network permission JSON to the supported public contract.
 * Unknown and retired keys remain stored but are never returned to clients.
 */
export function toPublicNetworkPermissions(value: unknown): NetworkPermissionsState {
  const stored = isRecord(value) ? value : {};
  const invitationLink = isRecord(stored.invitationLink)
    && typeof stored.invitationLink.code === 'string'
    ? { code: stored.invitationLink.code }
    : null;
  const contextInjection = isRecord(stored.contextInjection)
    && typeof stored.contextInjection.discovery === 'boolean'
    ? { discovery: stored.contextInjection.discovery }
    : undefined;

  return {
    joinPolicy: stored.joinPolicy === 'anyone' ? 'anyone' : 'invite_only',
    invitationLink,
    allowGuestVibeCheck: stored.allowGuestVibeCheck === true,
    ...(contextInjection ? { contextInjection } : {}),
  };
}
