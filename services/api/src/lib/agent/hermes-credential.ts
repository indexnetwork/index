export const HERMES_NEGOTIATOR_AUDIENCE = 'hermes-negotiator' as const;
export const HERMES_NEGOTIATOR_CREDENTIAL_KIND = 'agent-runtime' as const;

export const HERMES_INSTALLATION_NAME = 'Hermes on macOS' as const;

export type HermesActivationState = 'active' | 'revoked';

export type HermesCredentialAudience = typeof HERMES_NEGOTIATOR_AUDIENCE;

/** The negotiator audience uses the stricter scheduled-negotiation protocol. */
export function isDedicatedHermesNegotiationAudience(
  audience: HermesCredentialAudience | null,
): audience is HermesCredentialAudience {
  return audience === HERMES_NEGOTIATOR_AUDIENCE;
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
};
