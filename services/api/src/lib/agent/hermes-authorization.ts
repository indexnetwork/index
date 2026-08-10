import type { HermesCapability } from './hermes-capabilities';

export const HERMES_AGENT_AUDIENCE = 'hermes-agent' as const;
export const HERMES_AUTHORIZATION_REQUEST_TTL_MS = 10 * 60 * 1000;
export const HERMES_AUTHORIZATION_CODE_TTL_MS = 5 * 60 * 1000;
export const HERMES_CREDENTIAL_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export type HermesActivationState = 'pending' | 'active' | 'revoked';

export type HermesCredentialMetadata = {
  /** Internal transaction identity; omitted from public pending metadata. */
  ownerId: string;
  audience: typeof HERMES_AGENT_AUDIENCE;
  agentId: string;
  installationId: string;
  setupAttemptId: string;
  credentialId: string;
  actions: readonly HermesCapability[];
  expiresAt: Date;
  activationState: HermesActivationState;
};

export type HermesActivationPrincipal = Omit<HermesCredentialMetadata, 'activationState'>;

export class HermesAuthorizationError extends Error {
  constructor(
    readonly code: string,
    readonly status: number,
  ) {
    super(code);
    this.name = 'HermesAuthorizationError';
  }
}

export class AuthorizationInvalidRequestError extends HermesAuthorizationError {
  constructor() { super('invalid_request', 400); }
}
export class AuthorizationInvalidGrantError extends HermesAuthorizationError {
  constructor() { super('invalid_grant', 400); }
}
export class AuthorizationExpiredError extends HermesAuthorizationError {
  constructor() { super('expired_grant', 400); }
}
export class AuthorizationReplayError extends HermesAuthorizationError {
  constructor() { super('grant_replayed', 409); }
}
export class AuthorizationConflictError extends HermesAuthorizationError {
  constructor() { super('authorization_conflict', 409); }
}
export class InvalidHermesCredentialError extends HermesAuthorizationError {
  constructor() { super('invalid_credential', 401); }
}

export type CreateHermesAuthorizationRecord = {
  requestId: string;
  installationId: string;
  redirectUri: string;
  state: string;
  codeChallenge: string;
  codeChallengeMethod: 'S256';
  actions: readonly HermesCapability[];
  createdAt: Date;
  expiresAt: Date;
};

export type GetHermesAuthorizationRecord = {
  requestId: string;
  state: string;
  now: Date;
};

export type HermesAuthorizationRequestView = {
  requestId: string;
  installationId: string;
  redirectUri: string;
  state: string;
  actions: readonly HermesCapability[];
  expiresAt: Date;
};

export type ApproveHermesAuthorizationRecord = {
  requestId: string;
  state: string;
  redirectUri: string;
  ownerId: string;
  setupAttemptId: string;
  codeHash: string;
  now: Date;
  expiresAt: Date;
};

export type ExchangeHermesAuthorizationRecord = {
  requestId: string;
  codeHash: string;
  verifierChallenge: string;
  redirectUri: string;
  credentialId: string;
  credentialHash: string;
  replayReceipt: string;
  now: Date;
  expiresAt: Date;
};

/** Transactional persistence boundary for the browser authorization service. */
export interface HermesAuthorizationStore {
  createAuthorization(input: CreateHermesAuthorizationRecord): Promise<{
    requestId: string;
    state: string;
    expiresAt: Date;
  }>;
  getAuthorization(input: GetHermesAuthorizationRecord): Promise<HermesAuthorizationRequestView>;
  approveAuthorization(input: ApproveHermesAuthorizationRecord): Promise<{
    redirectUri: string;
    state: string;
    expiresAt: Date;
  }>;
  exchangeAuthorizationCode(input: ExchangeHermesAuthorizationRecord): Promise<HermesCredentialMetadata>;
  authenticatePendingCredential(credentialHash: string): Promise<HermesCredentialMetadata | null>;
  authenticateRevocableCredential(credentialHash: string): Promise<HermesCredentialMetadata | null>;
  activatePendingCredential(input: HermesActivationPrincipal): Promise<HermesCredentialMetadata>;
  disconnectCredential(input: HermesActivationPrincipal): Promise<{
    revoked: true;
    credentialId: string;
    setupAttemptId: string;
  }>;
}

/** SHA-256 base64url encoding shared by codes, PKCE, and dedicated credentials. */
export async function hashHermesSecret(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Buffer.from(digest).toString('base64url');
}

export const derivePkceS256Challenge = hashHermesSecret;

/** Strict standalone callback contract; browser URL parsing is owned elsewhere. */
export function isHermesLoopbackRedirect(value: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return false;
  }
  if (
    parsed.protocol !== 'http:'
    || parsed.hostname !== '127.0.0.1'
    || parsed.username !== ''
    || parsed.password !== ''
    || parsed.pathname !== '/callback'
    || parsed.search !== ''
    || parsed.hash !== ''
    || parsed.toString() !== value
  ) return false;
  const port = Number(parsed.port);
  return Number.isInteger(port) && port >= 49152 && port <= 65535;
}
