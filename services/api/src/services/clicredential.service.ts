import { cliCredentialAdapter, type CliCredentialStore, type CliProtocolVersion, type CreateCliCredentialResult } from '../adapters/clicredential.adapter';

/** Input proving both the active caller credential and the exact revocation target. */
export interface RevokeCliCredentialInput {
  userId: string;
  callerKey: string;
  keyId: string;
  targetKey: string;
}

/**
 * Issues and revokes fixed-shape credentials for authenticated CLI browser bridges.
 */
export class CliCredentialService {
  constructor(private readonly credentials: CliCredentialStore = cliCredentialAdapter) {}

  /**
   * Create a bounded CLI credential for a user.
   *
   * @param userId - Authenticated user ID.
   * @param protocolVersion - Validated mixed-version CLI protocol.
   * @returns Raw credential material and its expiry.
   */
  async create(
    userId: string,
    protocolVersion: CliProtocolVersion,
  ): Promise<CreateCliCredentialResult> {
    return this.credentials.create(userId, protocolVersion);
  }

  /**
   * Revoke an exact CLI credential while proving the active caller and target secrets.
   *
   * @param input - Authenticated owner and raw caller/target credential proof.
   * @returns True only after the adapter deletes the authoritative target row.
   */
  async revoke(input: RevokeCliCredentialInput): Promise<boolean> {
    return this.credentials.revoke(input);
  }
}

export const cliCredentialService = new CliCredentialService();
