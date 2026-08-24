/**
 * Sanitizes objects for inclusion in chat debug meta.
 * Strips embeddings, truncates long strings, and handles circular refs.
 */

const BLOCKLIST_KEYS = new Set([
  "embedding",
  "embeddingVector",
  "vector",
]);
const BLOCKLIST_SUFFIXES = ["Embedding", "Vector"];
const EMBEDDING_ARRAY_THRESHOLD = 100;
const DEFAULT_MAX_STRING_LENGTH = 2048;
/** Exported for tests that assert on circular-ref placeholder. */
export const SANITIZATION_ERROR_PLACEHOLDER = "[sanitization error]";

function isBlocklistedKey(key: string): boolean {
  if (BLOCKLIST_KEYS.has(key)) return true;
  return BLOCKLIST_SUFFIXES.some((s) => key.endsWith(s));
}

function isNumberArray(arr: unknown): arr is number[] {
  return Array.isArray(arr) && arr.length > 0 && typeof arr[0] === "number";
}

function truncateString(str: string, maxLen: number): string {
  if (str.length <= maxLen) return str;
  return `[truncated, ${str.length} chars]`;
}

function sanitizeValue(
  value: unknown,
  maxStringLength: number,
  seen: WeakSet<object>,
): unknown {
  if (value === null || value === undefined) return value;
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (typeof value === "string")
    return truncateString(value, maxStringLength);

  if (typeof value === "object") {
    if (seen.has(value as object)) return SANITIZATION_ERROR_PLACEHOLDER;
    seen.add(value as object);

    if (Array.isArray(value)) {
      if (isNumberArray(value) && value.length > EMBEDDING_ARRAY_THRESHOLD)
        return `[embedding, length ${value.length}]`;
      return value.map((item) => sanitizeValue(item, maxStringLength, seen));
    }

    const obj = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(obj)) {
      if (isBlocklistedKey(k)) {
        if (Array.isArray(v) && isNumberArray(v))
          out[k] = `[embedding, length ${v.length}]`;
        else if (Array.isArray(v))
          out[k] = `[array, length ${v.length}]`;
        else
          out[k] = "[redacted]";
      } else {
        out[k] = sanitizeValue(v, maxStringLength, seen);
      }
    }
    return out;
  }

  return value;
}

/**
 * Sanitizes an object for safe inclusion in debug meta.
 * - Replaces embedding/vector keys and long number arrays with placeholders.
 * - Truncates strings over maxStringLength.
 * - On circular reference or error, returns a placeholder string.
 *
 * @param obj - Value to sanitize (object, array, or primitive)
 * @param maxStringLength - Max string length before truncation (default 2048)
 * @returns Sanitized copy or "[sanitization error]" on failure
 */
export function sanitizeForDebugMeta(
  obj: unknown,
  maxStringLength: number = DEFAULT_MAX_STRING_LENGTH,
): unknown {
  try {
    const seen = new WeakSet<object>();
    return sanitizeValue(obj, maxStringLength, seen);
  } catch {
    return SANITIZATION_ERROR_PLACEHOLDER;
  }
}
