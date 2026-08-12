import { createHash } from 'node:crypto';

export const INDEX_APP_OWNER_AUDIENCE = 'index-app-owner' as const;
export const INDEX_APP_OWNER_CREDENTIAL_PREFIX = 'idxo_' as const;
export const INDEX_APP_OWNER_PROTOCOL_VERSION = 1 as const;
export const INDEX_APP_OWNER_REQUEST_TTL_MS = 10 * 60 * 1000;
export const INDEX_APP_OWNER_CODE_TTL_MS = 5 * 60 * 1000;
export const INDEX_APP_OWNER_CREDENTIAL_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export type IndexAppOwnerActivationState = 'pending' | 'active' | 'revoked';

export class IndexAppOwnerAuthorizationError extends Error {
  constructor(public readonly code: string, public readonly status: number) {
    super(code);
    this.name = 'IndexAppOwnerAuthorizationError';
  }
}
export class IndexAppOwnerInvalidRequestError extends IndexAppOwnerAuthorizationError {
  constructor() { super('invalid_request', 400); }
}
export class IndexAppOwnerInvalidGrantError extends IndexAppOwnerAuthorizationError {
  constructor() { super('invalid_grant', 403); }
}
export class IndexAppOwnerExpiredError extends IndexAppOwnerAuthorizationError {
  constructor() { super('expired', 410); }
}
export class IndexAppOwnerReplayError extends IndexAppOwnerAuthorizationError {
  constructor() { super('replayed', 409); }
}
export class IndexAppOwnerConflictError extends IndexAppOwnerAuthorizationError {
  constructor() { super('authorization_conflict', 409); }
}
export class InvalidIndexAppOwnerCredentialError extends IndexAppOwnerAuthorizationError {
  constructor() { super('invalid_credential', 403); }
}

export function isIndexAppOwnerLoopbackRedirect(value: string): boolean {
  let url: URL;
  try { url = new URL(value); } catch { return false; }
  const port = Number(url.port);
  return url.protocol === 'http:'
    && url.hostname === '127.0.0.1'
    && url.username === '' && url.password === ''
    && url.pathname === '/callback'
    && url.search === '' && url.hash === ''
    && url.toString() === value
    && Number.isInteger(port) && port >= 49152 && port <= 65535;
}

export async function hashIndexAppOwnerSecret(value: string): Promise<string> {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

export async function deriveIndexAppOwnerPkceS256Challenge(verifier: string): Promise<string> {
  return createHash('sha256').update(verifier, 'utf8').digest('base64url');
}

export type IndexAppOwnerCredentialMetadata = {
  ownerId: string;
  credentialId: string;
  installationId: string;
  generation: string;
  expiresAt: Date;
  activationState: IndexAppOwnerActivationState;
};

export type IndexAppOwnerActivationPrincipal = Omit<IndexAppOwnerCredentialMetadata, 'activationState'>;

export interface IndexAppOwnerAuthorizationStore {
  createAuthorization(input: {
    requestId: string; installationId: string; redirectUri: string; state: string;
    codeChallenge: string; codeChallengeMethod: 'S256'; legacyKeyId: string | null;
    createdAt: Date; expiresAt: Date;
  }): Promise<{ requestId: string; state: string; expiresAt: Date }>;
  getAuthorization(input: { requestId: string; state: string; now: Date }): Promise<{
    requestId: string; installationId: string; redirectUri: string; state: string;
    legacyKeyId: string | null; expiresAt: Date;
  }>;
  approveAuthorization(input: {
    requestId: string; ownerId: string; state: string; redirectUri: string;
    codeHash: string; now: Date; expiresAt: Date;
  }): Promise<{ state: string; redirectUri: string; expiresAt: Date }>;
  exchangeAuthorizationCode(input: {
    requestId: string; state: string; codeHash: string; verifierChallenge: string;
    redirectUri: string; credentialId: string; credentialHash: string;
    activationProofHash: string; generation: string; replayReceipt: string;
    now: Date; expiresAt: Date;
  }): Promise<IndexAppOwnerCredentialMetadata>;
  authenticatePendingCredential(credentialHash: string): Promise<IndexAppOwnerCredentialMetadata | null>;
  activatePendingCredential(input: {
    principal: IndexAppOwnerActivationPrincipal; activationProofHash: string; now: Date;
  }): Promise<IndexAppOwnerCredentialMetadata>;
  rollbackPendingCredential(input: {
    principal: IndexAppOwnerActivationPrincipal; activationProofHash: string; now: Date;
  }): Promise<{ revoked: true; credentialId: string }>;
  authenticateRevocableCredential(credentialHash: string): Promise<IndexAppOwnerCredentialMetadata | null>;
  revokeCredential(input: {
    principal: IndexAppOwnerActivationPrincipal; now: Date;
  }): Promise<{ revoked: true; credentialId: string }>;
}
