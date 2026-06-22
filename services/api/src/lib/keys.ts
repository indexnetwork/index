/**
 * Key generation and validation utilities for human-readable identifiers.
 *
 * Keys are URL-safe, kebab-case strings used as alternatives to UUIDs
 * for users and indexes.
 */

/** Reserved words that cannot be used as keys. */
const RESERVED_KEYS = new Set([
  'me', 'new', 'edit', 'delete', 'settings', 'admin',
  'api', 'auth', 'login', 'logout', 'signup', 'register',
]);

/** Pattern for a valid key: lowercase alphanumeric + hyphens, no leading/trailing hyphens. */
const KEY_PATTERN = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/;

/** Minimum key length. */
const MIN_KEY_LENGTH = 3;

/** Maximum key length. */
const MAX_KEY_LENGTH = 64;

/** UUID v4 format pattern for detection. */
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Convert a display name or title to a kebab-case key candidate.
 *
 * @param input - The name or title to convert.
 * @returns A kebab-case string suitable for use as a key.
 */
export function toKebabKey(input: string): string {
  return input
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // strip diacritics
    .replace(/[^a-z0-9\s-]/g, '') // keep only alphanumeric, spaces, hyphens
    .replace(/\s+/g, '-') // spaces to hyphens
    .replace(/-+/g, '-') // collapse consecutive hyphens
    .replace(/^-+|-+$/g, '') // trim leading/trailing hyphens
    .slice(0, MAX_KEY_LENGTH);
}

/**
 * Validate a key string for format compliance.
 *
 * @param key - The key to validate.
 * @returns An object with `valid` boolean and optional `error` message.
 */
export function validateKey(key: string): { valid: boolean; error?: string } {
  if (key.length < MIN_KEY_LENGTH) {
    return { valid: false, error: `Key must be at least ${MIN_KEY_LENGTH} characters` };
  }
  if (key.length > MAX_KEY_LENGTH) {
    return { valid: false, error: `Key must be at most ${MAX_KEY_LENGTH} characters` };
  }
  if (!KEY_PATTERN.test(key)) {
    return { valid: false, error: 'Key must contain only lowercase letters, numbers, and hyphens, and cannot start or end with a hyphen' };
  }
  if (RESERVED_KEYS.has(key)) {
    return { valid: false, error: `"${key}" is a reserved word and cannot be used as a key` };
  }
  return { valid: true };
}

/**
 * Detect whether a string is a UUID.
 *
 * @param value - The string to check.
 * @returns True if the string matches UUID v4 format.
 */
export function isUUID(value: string): boolean {
  return UUID_PATTERN.test(value);
}

/**
 * Detect whether a string looks like a hex ID prefix (for prefix-matching).
 * Must be 1-36 hex characters and NOT a valid full UUID.
 *
 * @param value - The string to check.
 * @returns True if the value is a plausible hex prefix.
 */
export function isHexPrefix(value: string): boolean {
  return /^[0-9a-f]{1,36}$/i.test(value) && !isUUID(value);
}

/**
 * Generate a unique key from a display name, checking against existing keys.
 *
 * @param name - The display name to derive the key from.
 * @param existsCheck - Async function that returns true if the key is already taken.
 * @returns A unique key string.
 */
export async function generateUniqueKey(
  name: string,
  existsCheck: (candidate: string) => Promise<boolean>,
): Promise<string> {
  const base = toKebabKey(name);
  if (!base || base.length < MIN_KEY_LENGTH) {
    // Name is too short or produces no valid chars; skip key generation
    return '';
  }

  // Try the base key first
  if (!(await existsCheck(base)) && !RESERVED_KEYS.has(base)) {
    return base;
  }

  // Try with numeric suffixes
  for (let i = 2; i <= 100; i++) {
    const candidate = `${base}-${i}`.slice(0, MAX_KEY_LENGTH);
    if (!(await existsCheck(candidate)) && !RESERVED_KEYS.has(candidate)) {
      return candidate;
    }
  }

  // Fallback: append random chars
  const suffix = Math.random().toString(36).slice(2, 8);
  return `${base}-${suffix}`.slice(0, MAX_KEY_LENGTH);
}
