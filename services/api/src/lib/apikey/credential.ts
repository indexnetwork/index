const API_KEY_CHARACTERS = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';
const MAX_UNBIASED_BYTE = 256 - (256 % API_KEY_CHARACTERS.length);

/** Better Auth-compatible raw API-key length. */
export const API_KEY_LENGTH = 64;

/** Number of leading raw-key characters retained for credential display. */
export const API_KEY_START_LENGTH = 6;

/**
 * Generate a high-entropy alphabetic API key without modulo bias.
 *
 * @param length - Number of characters to generate.
 * @returns A cryptographically random API-key string.
 */
export function generateApiKey(length: number = API_KEY_LENGTH): string {
  let result = '';

  while (result.length < length) {
    const bytes = crypto.getRandomValues(new Uint8Array(128));
    for (const byte of bytes) {
      if (byte >= MAX_UNBIASED_BYTE) continue;
      result += API_KEY_CHARACTERS[byte % API_KEY_CHARACTERS.length];
      if (result.length === length) break;
    }
  }

  return result;
}

/**
 * Hash a plaintext API key using Better Auth's SHA-256 base64url format.
 *
 * @param key - Raw API-key secret.
 * @returns Base64url SHA-256 digest without padding.
 */
export async function hashApiKey(key: string): Promise<string> {
  const encoded = new TextEncoder().encode(key);
  const hash = await crypto.subtle.digest('SHA-256', encoded);
  return Buffer.from(hash).toString('base64url');
}
