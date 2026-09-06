import { createAuthClient } from "better-auth/react";
import { magicLinkClient, jwtClient } from "better-auth/client/plugins";
import { apiKeyClient } from "@better-auth/api-key/client";

// In production, VITE_PROTOCOL_URL points to the protocol service; in dev, Vite proxies /api
export const authClient = createAuthClient({
  baseURL: import.meta.env.VITE_PROTOCOL_URL || '',
  basePath: "/api/auth",
  plugins: [magicLinkClient(), jwtClient(), apiKeyClient()],
});

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
