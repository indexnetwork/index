/**
 * Client id presented to the device authorization grant. The browser mints the
 * code and the CLI redeems it, so this must match the value the web app sends.
 */
const DEVICE_CLIENT_ID = "index-device";

interface DeviceTokenResponse {
  access_token?: string;
  error?: string;
  error_description?: string;
}

/**
 * Exchange an approved device code for this device's own session token.
 *
 * @param baseUrl - Protocol server base URL, without a trailing slash.
 * @param deviceCode - Code the browser claimed and approved for the owner.
 * @returns The session token to store and send as a bearer credential.
 * @throws Error when the code is unknown, expired, denied or still pending.
 */
export async function redeemDeviceCode(baseUrl: string, deviceCode: string): Promise<string> {
  // The session records this request's user agent, and that is what names the
  // device in Index settings.
  const response = await fetch(`${baseUrl}/api/auth/device/token`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "User-Agent": "index-cli" },
    body: JSON.stringify({
      grant_type: "urn:ietf:params:oauth:grant-type:device_code",
      device_code: deviceCode,
      client_id: DEVICE_CLIENT_ID,
    }),
  });

  const body = (await response.json().catch(() => null)) as DeviceTokenResponse | null;
  if (!response.ok || !body?.access_token) {
    throw new Error(body?.error_description ?? "Could not complete device sign-in.");
  }
  return body.access_token;
}

/**
 * Revoke a device session server-side using the session's own token.
 *
 * @param baseUrl - Protocol server base URL, without a trailing slash.
 * @param token - The session token to revoke.
 * @returns Whether the server confirmed the revocation.
 */
export async function revokeSession(baseUrl: string, token: string): Promise<boolean> {
  try {
    const response = await fetch(`${baseUrl}/api/auth/sign-out`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
    });
    return response.ok;
  } catch {
    return false;
  }
}
