import type { HermesCredentialAudience } from './agent/hermes-credential';

export type ApiKeyAudience = HermesCredentialAudience | null;

export type RequestAuthContext =
  | { kind: 'session' }
  | {
      kind: 'api_key';
      agentId: string | null;
      /** Explicit credential audience. Null preserves legacy API-key behavior. */
      audience?: ApiKeyAudience;
      /** Exact persisted API-key row used by this request. */
      credentialId?: string | null;
      /** Hermes setup generation carried by the authenticated credential. */
      setupAttemptId?: string | null;
    };

const requestAuthContexts = new WeakMap<Request, RequestAuthContext>();

/**
 * Record the credential context established by a successful authentication guard.
 *
 * @param req - Authenticated request
 * @param context - Credential kind and optional API-key agent binding
 */
export function recordRequestAuthContext(req: Request, context: RequestAuthContext): void {
  requestAuthContexts.set(req, context);
}

/**
 * Read the credential context established for a request.
 *
 * @param req - Request whose authentication context should be read
 * @returns Recorded context, or undefined when the route was not authenticated by a supported guard
 */
export function getRequestAuthContext(req: Request): RequestAuthContext | undefined {
  return requestAuthContexts.get(req);
}
