import { AuthorizationInvalidGrantError, HERMES_AGENT_AUDIENCE, HERMES_AUTHORIZATION_CODE_TTL_MS, HERMES_AUTHORIZATION_REQUEST_TTL_MS, HERMES_CREDENTIAL_TTL_MS, HERMES_INSTALLATION_NAME, InvalidHermesCredentialError, derivePkceS256Challenge, hashHermesSecret, type HermesActivationPrincipal, type HermesAuthorizationStore, type HermesCredentialMetadata } from '../lib/agent/hermes-authorization';
import { isExactHermesCapabilitySet, type HermesCapability } from '../lib/agent/hermes-capabilities';

export type HermesAuthorizationServiceDependencies = {
  now: () => Date;
  randomId: () => string;
  randomSecret: () => string;
};

const defaultDependencies: HermesAuthorizationServiceDependencies = {
  now: () => new Date(),
  randomId: () => crypto.randomUUID(),
  randomSecret: () => Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('base64url'),
};

export type CreateHermesAuthorizationInput = {
  installationId: string;
  redirectUri: string;
  state: string;
  codeChallenge: string;
  actions: readonly HermesCapability[];
};

function publicMetadata(metadata: HermesCredentialMetadata) {
  return {
    audience: metadata.audience,
    agentId: metadata.agentId,
    installationId: metadata.installationId,
    setupAttemptId: metadata.setupAttemptId,
    credentialId: metadata.credentialId,
    actions: [...metadata.actions],
    expiresAt: metadata.expiresAt,
    activationState: metadata.activationState,
  };
}

/** Orchestrates one-time Hermes authorization without retaining raw secrets. */
export class HermesAuthorizationService {
  constructor(
    private readonly store: HermesAuthorizationStore = lazyHermesAuthorizationStore,
    private readonly dependencies: HermesAuthorizationServiceDependencies = defaultDependencies,
  ) {}

  /** Persist a ten-minute PKCE request containing no verifier or authorization code. */
  async createAuthorization(input: CreateHermesAuthorizationInput) {
    const now = this.dependencies.now();
    return this.store.createAuthorization({
      requestId: this.dependencies.randomId(),
      installationId: input.installationId,
      redirectUri: input.redirectUri,
      state: input.state,
      codeChallenge: input.codeChallenge,
      codeChallengeMethod: 'S256',
      actions: input.actions,
      createdAt: now,
      expiresAt: new Date(now.getTime() + HERMES_AUTHORIZATION_REQUEST_TTL_MS),
    });
  }

  /** Resolve only narrow pending metadata bound to the request's secret state and callback. */
  async getAuthorization(requestId: string, state: string, redirectUri: string) {
    const pending = await this.store.getAuthorization({ requestId, state, now: this.dependencies.now() });
    if (pending.redirectUri !== redirectUri) throw new AuthorizationInvalidGrantError();
    return {
      requestId: pending.requestId,
      installationId: pending.installationId,
      installationName: HERMES_INSTALLATION_NAME,
      actions: [...pending.actions],
      expiresAt: pending.expiresAt,
    };
  }

  /** Owner-approve one state/redirect-bound request and return its raw five-minute code exactly once. */
  async approveAuthorization(ownerId: string, requestId: string, state: string, redirectUri: string) {
    const now = this.dependencies.now();
    const pending = await this.store.getAuthorization({ requestId, state, now });
    if (pending.redirectUri !== redirectUri) throw new AuthorizationInvalidGrantError();
    const code = this.dependencies.randomSecret();
    const approved = await this.store.approveAuthorization({
      requestId,
      state,
      redirectUri,
      ownerId,
      setupAttemptId: this.dependencies.randomId(),
      codeHash: await hashHermesSecret(code),
      now,
      expiresAt: new Date(now.getTime() + HERMES_AUTHORIZATION_CODE_TTL_MS),
    });
    return { requestId, code, state: approved.state };
  }

  /** Atomically consume one PKCE code and return one pending 30-day credential. */
  async exchangeAuthorizationCode(input: {
    requestId: string;
    code: string;
    verifier: string;
    redirectUri: string;
  }) {
    const now = this.dependencies.now();
    const credential = `idxh_${this.dependencies.randomSecret()}`;
    const metadata = await this.store.exchangeAuthorizationCode({
      requestId: input.requestId,
      codeHash: await hashHermesSecret(input.code),
      verifierChallenge: await derivePkceS256Challenge(input.verifier),
      redirectUri: input.redirectUri,
      credentialId: this.dependencies.randomId(),
      credentialHash: await hashHermesSecret(credential),
      replayReceipt: this.dependencies.randomId(),
      now,
      expiresAt: new Date(now.getTime() + HERMES_CREDENTIAL_TTL_MS),
    });
    return { credential, ...publicMetadata(metadata) };
  }

  /**
   * Narrow Task 2 authentication seam: resolve only an exact pending `idxh_`
   * row. It intentionally does not produce a generic request principal.
   */
  async authenticatePendingHermesCredential(rawCredential: string): Promise<HermesActivationPrincipal> {
    if (!rawCredential.startsWith('idxh_')) throw new InvalidHermesCredentialError();
    const metadata = await this.store.authenticatePendingCredential(await hashHermesSecret(rawCredential));
    if (!metadata || metadata.audience !== HERMES_AGENT_AUDIENCE || metadata.activationState !== 'pending') {
      throw new InvalidHermesCredentialError();
    }
    return {
      ownerId: metadata.ownerId,
      audience: metadata.audience,
      agentId: metadata.agentId,
      installationId: metadata.installationId,
      setupAttemptId: metadata.setupAttemptId,
      credentialId: metadata.credentialId,
      actions: metadata.actions,
      expiresAt: metadata.expiresAt,
    };
  }

  /** Resolve one exact dedicated row solely for expiry-safe self-revocation. */
  async authenticateRevocableHermesCredential(rawCredential: string): Promise<HermesActivationPrincipal> {
    if (!rawCredential.startsWith('idxh_')) throw new InvalidHermesCredentialError();
    const metadata = await this.store.authenticateRevocableCredential(await hashHermesSecret(rawCredential));
    if (
      !metadata
      || metadata.audience !== HERMES_AGENT_AUDIENCE
      || !['pending', 'active', 'revoked'].includes(metadata.activationState)
      || !isExactHermesCapabilitySet(metadata.actions)
    ) throw new InvalidHermesCredentialError();
    return {
      ownerId: metadata.ownerId,
      audience: metadata.audience,
      agentId: metadata.agentId,
      installationId: metadata.installationId,
      setupAttemptId: metadata.setupAttemptId,
      credentialId: metadata.credentialId,
      actions: metadata.actions,
      expiresAt: metadata.expiresAt,
    };
  }

  /** Install the exact pending generation's permission after native confirmation. */
  async activatePendingHermesCredential(principal: HermesActivationPrincipal) {
    return publicMetadata(await this.store.activatePendingCredential(principal));
  }

  /** Revoke this exact credential/generation and restore Index authority. */
  async disconnectHermesCredential(principal: HermesActivationPrincipal) {
    return this.store.disconnectCredential(principal);
  }
}

const lazyHermesAuthorizationStore: HermesAuthorizationStore = {
  async createAuthorization(input) {
    const { hermesAuthorizationDatabaseAdapter } = await import('../adapters/hermes-authorization.database.adapter');
    return hermesAuthorizationDatabaseAdapter.createAuthorization(input);
  },
  async getAuthorization(input) {
    const { hermesAuthorizationDatabaseAdapter } = await import('../adapters/hermes-authorization.database.adapter');
    return hermesAuthorizationDatabaseAdapter.getAuthorization(input);
  },
  async approveAuthorization(input) {
    const { hermesAuthorizationDatabaseAdapter } = await import('../adapters/hermes-authorization.database.adapter');
    return hermesAuthorizationDatabaseAdapter.approveAuthorization(input);
  },
  async exchangeAuthorizationCode(input) {
    const { hermesAuthorizationDatabaseAdapter } = await import('../adapters/hermes-authorization.database.adapter');
    return hermesAuthorizationDatabaseAdapter.exchangeAuthorizationCode(input);
  },
  async authenticatePendingCredential(credentialHash) {
    const { hermesAuthorizationDatabaseAdapter } = await import('../adapters/hermes-authorization.database.adapter');
    return hermesAuthorizationDatabaseAdapter.authenticatePendingCredential(credentialHash);
  },
  async authenticateRevocableCredential(credentialHash) {
    const { hermesAuthorizationDatabaseAdapter } = await import('../adapters/hermes-authorization.database.adapter');
    return hermesAuthorizationDatabaseAdapter.authenticateRevocableCredential(credentialHash);
  },
  async activatePendingCredential(input) {
    const { hermesAuthorizationDatabaseAdapter } = await import('../adapters/hermes-authorization.database.adapter');
    return hermesAuthorizationDatabaseAdapter.activatePendingCredential(input);
  },
  async disconnectCredential(input) {
    const { hermesAuthorizationDatabaseAdapter } = await import('../adapters/hermes-authorization.database.adapter');
    return hermesAuthorizationDatabaseAdapter.disconnectCredential(input);
  },
};

export const hermesAuthorizationService = new HermesAuthorizationService();
