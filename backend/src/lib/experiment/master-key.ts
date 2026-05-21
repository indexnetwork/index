/**
 * Shared helpers for the experiment-network master key. Owns the alphabet,
 * length, and hashing scheme so that key generation and key verification
 * cannot drift out of sync.
 *
 * The plaintext key is shown to the operator exactly once (at creation or
 * after rotation). The database stores only the SHA-256/base64url hash.
 */

const KEY_ALPHABET = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';
const KEY_LENGTH = 64;

export async function hashMasterKey(plaintext: string): Promise<string> {
  const encoded = new TextEncoder().encode(plaintext);
  const digest = await crypto.subtle.digest('SHA-256', encoded);
  return Buffer.from(digest).toString('base64url');
}

export async function generateMasterKey(): Promise<{ key: string; hash: string }> {
  const bytes = crypto.getRandomValues(new Uint8Array(KEY_LENGTH));
  let key = '';
  for (let i = 0; i < KEY_LENGTH; i++) {
    key += KEY_ALPHABET[bytes[i] % KEY_ALPHABET.length];
  }
  const hash = await hashMasterKey(key);
  return { key, hash };
}
