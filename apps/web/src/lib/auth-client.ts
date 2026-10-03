import { createAuthClient } from "better-auth/react";
import { magicLinkClient, jwtClient, deviceAuthorizationClient } from "better-auth/client/plugins";
import { apiKeyClient } from "@better-auth/api-key/client";

import { protocolOrigin } from "./protocol-origin";

// In production this is the protocol service. In dev it stays empty so Vite proxies /api,
// unless settings has pointed the app at another origin.
export const authClient = createAuthClient({
  baseURL: protocolOrigin(),
  basePath: "/api/auth",
  plugins: [magicLinkClient(), jwtClient(), apiKeyClient(), deviceAuthorizationClient()],
});

const authBaseURL = `${protocolOrigin()}/api/auth`;

export async function getMcpConsentDetails(code: string): Promise<{ clientName: string; redirectURI: string }> {
  const url = `${authBaseURL}/mcp/consent-details?${new URLSearchParams({ consent_code: code })}`;
  const response = await fetch(url, { credentials: 'include' });
  if (!response.ok) throw new Error('This authorization request is no longer available for this account.');
  return response.json();
}

export async function decideMcpConsent(code: string, accept: boolean): Promise<string> {
  const response = await fetch(`${authBaseURL}/mcp/consent`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ consent_code: code, accept }),
  });
  if (!response.ok) throw new Error('Could not complete authorization. Please try again.');
  const result = await response.json() as { redirectURI: string };
  return result.redirectURI;
}

let cachedToken: string | null = null;
let tokenExpiresAt = 0;

const JWT_TOKEN_TIMEOUT_MS = 10_000;

/** Authentication failed before an authenticated API request could begin. */
export class AuthSessionError extends Error {
  constructor(message = 'Your session has expired. Please sign in again.') {
    super(message);
    this.name = 'AuthSessionError';
  }
}

/** Returns whether an unknown failure requires a fresh authenticated session. */
export function isAuthSessionError(error: unknown): error is AuthSessionError {
  return error instanceof AuthSessionError;
}

function readTokenExpiry(token: string): number {
  const encodedPayload = token.split('.')[1];
  if (!encodedPayload) throw new AuthSessionError();

  try {
    const normalized = encodedPayload.replace(/-/g, '+').replace(/_/g, '/');
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=');
    const payload = JSON.parse(atob(padded)) as { exp?: unknown };
    if (typeof payload.exp !== 'number' || !Number.isFinite(payload.exp)) {
      throw new AuthSessionError();
    }
    return payload.exp * 1000;
  } catch (error) {
    if (error instanceof AuthSessionError) throw error;
    throw new AuthSessionError();
  }
}

/** Returns a cached JWT, refreshing if within 60s of expiry. */
export async function getJwtToken(): Promise<string> {
  if (cachedToken && Date.now() < tokenExpiresAt - 60_000) {
    return cachedToken;
  }

  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  try {
    const { data, error } = await Promise.race([
      authClient.token(),
      new Promise<never>((_, reject) => {
        timeoutId = setTimeout(() => reject(new AuthSessionError()), JWT_TOKEN_TIMEOUT_MS);
      }),
    ]);
    if (error || !data?.token) throw new AuthSessionError();

    const expiresAt = readTokenExpiry(data.token);
    if (expiresAt <= Date.now()) throw new AuthSessionError();

    cachedToken = data.token;
    tokenExpiresAt = expiresAt;
    return cachedToken;
  } catch (error) {
    clearJwtToken();
    if (error instanceof AuthSessionError) throw error;
    throw new AuthSessionError();
  } finally {
    if (timeoutId !== undefined) clearTimeout(timeoutId);
  }
}

export function clearJwtToken() {
  cachedToken = null;
  tokenExpiresAt = 0;
}
