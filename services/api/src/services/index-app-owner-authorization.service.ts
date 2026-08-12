import { INDEX_APP_OWNER_CODE_TTL_MS, INDEX_APP_OWNER_CREDENTIAL_PREFIX, INDEX_APP_OWNER_CREDENTIAL_TTL_MS, INDEX_APP_OWNER_REQUEST_TTL_MS, IndexAppOwnerInvalidGrantError, InvalidIndexAppOwnerCredentialError, deriveIndexAppOwnerPkceS256Challenge, hashIndexAppOwnerSecret, type IndexAppOwnerActivationPrincipal, type IndexAppOwnerAuthorizationStore } from '../lib/agent/index-app-owner-authorization';

export type IndexAppOwnerAuthorizationDependencies = {
  now: () => Date;
  randomId: () => string;
  randomSecret: () => string;
};

const defaultDependencies: IndexAppOwnerAuthorizationDependencies = {
  now: () => new Date(),
  randomId: () => crypto.randomUUID(),
  randomSecret: () => Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('base64url'),
};

export class IndexAppOwnerAuthorizationService {
  constructor(
    private readonly store: IndexAppOwnerAuthorizationStore = lazyStore,
    private readonly dependencies: IndexAppOwnerAuthorizationDependencies = defaultDependencies,
  ) {}

  async createAuthorization(input: {
    installationId: string; redirectUri: string; state: string;
    codeChallenge: string; legacyKeyId: string | null;
  }) {
    const createdAt = this.dependencies.now();
    return this.store.createAuthorization({
      ...input,
      requestId: this.dependencies.randomId(),
      codeChallengeMethod: 'S256',
      createdAt,
      expiresAt: new Date(createdAt.getTime() + INDEX_APP_OWNER_REQUEST_TTL_MS),
    });
  }

  async getAuthorization(requestId: string, state: string, redirectUri: string) {
    const pending = await this.store.getAuthorization({ requestId, state, now: this.dependencies.now() });
    if (pending.redirectUri !== redirectUri) throw new IndexAppOwnerInvalidGrantError();
    return {
      requestId: pending.requestId,
      installationId: pending.installationId,
      legacyRevocationRequired: pending.legacyKeyId !== null,
      expiresAt: pending.expiresAt,
    };
  }

  async approveAuthorization(
    ownerId: string, requestId: string, state: string, redirectUri: string,
  ) {
    const now = this.dependencies.now();
    const pending = await this.store.getAuthorization({ requestId, state, now });
    if (pending.redirectUri !== redirectUri) throw new IndexAppOwnerInvalidGrantError();
    const code = this.dependencies.randomSecret();
    await this.store.approveAuthorization({
      requestId, ownerId, state, redirectUri,
      codeHash: await hashIndexAppOwnerSecret(code),
      now, expiresAt: new Date(now.getTime() + INDEX_APP_OWNER_CODE_TTL_MS),
    });
    return { requestId, code, state };
  }

  async exchangeAuthorizationCode(input: {
    requestId: string; code: string; state: string; verifier: string; redirectUri: string;
  }) {
    const now = this.dependencies.now();
    const credential = `${INDEX_APP_OWNER_CREDENTIAL_PREFIX}${this.dependencies.randomSecret()}`;
    const activationProof = this.dependencies.randomSecret();
    const metadata = await this.store.exchangeAuthorizationCode({
      requestId: input.requestId,
      state: input.state,
      codeHash: await hashIndexAppOwnerSecret(input.code),
      verifierChallenge: await deriveIndexAppOwnerPkceS256Challenge(input.verifier),
      redirectUri: input.redirectUri,
      credentialId: this.dependencies.randomId(),
      credentialHash: await hashIndexAppOwnerSecret(credential),
      activationProofHash: await hashIndexAppOwnerSecret(activationProof),
      generation: this.dependencies.randomId(),
      replayReceipt: this.dependencies.randomId(),
      now,
      expiresAt: new Date(now.getTime() + INDEX_APP_OWNER_CREDENTIAL_TTL_MS),
    });
    return { credential, activationProof, ...metadata };
  }

  async authenticatePendingCredential(rawCredential: string): Promise<IndexAppOwnerActivationPrincipal> {
    if (!rawCredential.startsWith(INDEX_APP_OWNER_CREDENTIAL_PREFIX)) {
      throw new InvalidIndexAppOwnerCredentialError();
    }
    const metadata = await this.store.authenticatePendingCredential(
      await hashIndexAppOwnerSecret(rawCredential),
    );
    if (!metadata || metadata.activationState !== 'pending') throw new InvalidIndexAppOwnerCredentialError();
    const { activationState: _state, ...principal } = metadata;
    return principal;
  }

  async activatePendingCredential(principal: IndexAppOwnerActivationPrincipal, activationProof: string) {
    return this.store.activatePendingCredential({
      principal,
      activationProofHash: await hashIndexAppOwnerSecret(activationProof),
      now: this.dependencies.now(),
    });
  }

  async rollbackPendingCredential(principal: IndexAppOwnerActivationPrincipal, activationProof: string) {
    return this.store.rollbackPendingCredential({
      principal,
      activationProofHash: await hashIndexAppOwnerSecret(activationProof),
      now: this.dependencies.now(),
    });
  }

  async authenticateRevocableCredential(rawCredential: string): Promise<IndexAppOwnerActivationPrincipal> {
    if (!rawCredential.startsWith(INDEX_APP_OWNER_CREDENTIAL_PREFIX)) {
      throw new InvalidIndexAppOwnerCredentialError();
    }
    const metadata = await this.store.authenticateRevocableCredential(
      await hashIndexAppOwnerSecret(rawCredential),
    );
    if (!metadata || !['pending', 'active', 'revoked'].includes(metadata.activationState)) {
      throw new InvalidIndexAppOwnerCredentialError();
    }
    const { activationState: _state, ...principal } = metadata;
    return principal;
  }

  revokeCredential(principal: IndexAppOwnerActivationPrincipal) {
    return this.store.revokeCredential({ principal, now: this.dependencies.now() });
  }
}

const lazyStore: IndexAppOwnerAuthorizationStore = {
  async createAuthorization(input) {
    const { indexAppOwnerAuthorizationDatabaseAdapter } = await import('../adapters/index-app-owner-authorization.database.adapter');
    return indexAppOwnerAuthorizationDatabaseAdapter.createAuthorization(input);
  },
  async getAuthorization(input) {
    const { indexAppOwnerAuthorizationDatabaseAdapter } = await import('../adapters/index-app-owner-authorization.database.adapter');
    return indexAppOwnerAuthorizationDatabaseAdapter.getAuthorization(input);
  },
  async approveAuthorization(input) {
    const { indexAppOwnerAuthorizationDatabaseAdapter } = await import('../adapters/index-app-owner-authorization.database.adapter');
    return indexAppOwnerAuthorizationDatabaseAdapter.approveAuthorization(input);
  },
  async exchangeAuthorizationCode(input) {
    const { indexAppOwnerAuthorizationDatabaseAdapter } = await import('../adapters/index-app-owner-authorization.database.adapter');
    return indexAppOwnerAuthorizationDatabaseAdapter.exchangeAuthorizationCode(input);
  },
  async authenticatePendingCredential(credentialHash) {
    const { indexAppOwnerAuthorizationDatabaseAdapter } = await import('../adapters/index-app-owner-authorization.database.adapter');
    return indexAppOwnerAuthorizationDatabaseAdapter.authenticatePendingCredential(credentialHash);
  },
  async activatePendingCredential(input) {
    const { indexAppOwnerAuthorizationDatabaseAdapter } = await import('../adapters/index-app-owner-authorization.database.adapter');
    return indexAppOwnerAuthorizationDatabaseAdapter.activatePendingCredential(input);
  },
  async rollbackPendingCredential(input) {
    const { indexAppOwnerAuthorizationDatabaseAdapter } = await import('../adapters/index-app-owner-authorization.database.adapter');
    return indexAppOwnerAuthorizationDatabaseAdapter.rollbackPendingCredential(input);
  },
  async authenticateRevocableCredential(credentialHash) {
    const { indexAppOwnerAuthorizationDatabaseAdapter } = await import('../adapters/index-app-owner-authorization.database.adapter');
    return indexAppOwnerAuthorizationDatabaseAdapter.authenticateRevocableCredential(credentialHash);
  },
  async revokeCredential(input) {
    const { indexAppOwnerAuthorizationDatabaseAdapter } = await import('../adapters/index-app-owner-authorization.database.adapter');
    return indexAppOwnerAuthorizationDatabaseAdapter.revokeCredential(input);
  },
};

export const indexAppOwnerAuthorizationService = new IndexAppOwnerAuthorizationService();
