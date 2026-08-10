import { HERMES_AGENT_AUDIENCE } from './hermes-authorization';
import type { HermesCapability } from './hermes-capabilities';

export const HERMES_NEGOTIATOR_AUDIENCE = 'hermes-negotiator' as const;
export const HERMES_NEGOTIATOR_CREDENTIAL_KIND = 'agent-runtime' as const;
export const HERMES_AGENT_CREDENTIAL_PREFIX = 'idxh_' as const;

export type HermesCredentialAudience =
  | typeof HERMES_NEGOTIATOR_AUDIENCE
  | typeof HERMES_AGENT_AUDIENCE;

/** Both dedicated audiences use the stricter scheduled-negotiation protocol. */
export function isDedicatedHermesNegotiationAudience(
  audience: HermesCredentialAudience | null,
): audience is HermesCredentialAudience {
  return audience === HERMES_NEGOTIATOR_AUDIENCE || audience === HERMES_AGENT_AUDIENCE;
}
/** Prepared installations rotate through setup; credentials may never be perpetual. */
export const HERMES_NEGOTIATOR_CREDENTIAL_TTL_MS = 30 * 24 * 60 * 60 * 1_000;

export function isHermesNegotiatorAudience(metadata: unknown): boolean {
  let value = metadata;
  if (typeof metadata === 'string') {
    try {
      value = JSON.parse(metadata) as unknown;
    } catch {
      return false;
    }
  }
  return Boolean(
    value
    && typeof value === 'object'
    && !Array.isArray(value)
    && (value as Record<string, unknown>).audience === HERMES_NEGOTIATOR_AUDIENCE,
  );
}

export type NegotiationCredentialPrincipal = {
  credentialId: string;
  agentId: string;
  audience: HermesCredentialAudience | null;
  setupAttemptId: string | null;
  /** Present for the full standalone principal; absent on legacy/negotiator keys. */
  installationId?: string | null;
  /** Exact active dedicated-row capabilities used by the transaction fence. */
  actions?: readonly HermesCapability[];
};
