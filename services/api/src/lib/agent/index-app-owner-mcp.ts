const MAX_DEPTH = 16;
const MAX_OBJECT_KEYS = 64;
const MAX_ARRAY_ITEMS = 100;
const MAX_STRING_BYTES = 65_536;
const MAX_SERIALIZED_BYTES = 262_144;
const utf8 = new TextEncoder();

function exactKeys(value: Record<string, unknown>, required: readonly string[]): boolean {
  const keys = Object.keys(value);
  return keys.length === required.length && required.every((key) => Object.prototype.hasOwnProperty.call(value, key));
}

function globallyBounded(value: unknown, depth = 0): boolean {
  if (depth > MAX_DEPTH) return false;
  if (value === null || typeof value === 'boolean') return true;
  if (typeof value === 'number') return Number.isFinite(value);
  if (typeof value === 'string') return utf8.encode(value).byteLength <= MAX_STRING_BYTES;
  if (Array.isArray(value)) {
    return value.length <= MAX_ARRAY_ITEMS && value.every((item) => globallyBounded(item, depth + 1));
  }
  if (typeof value !== 'object') return false;
  const object = value as Record<string, unknown>;
  const keys = Object.keys(object);
  return keys.length <= MAX_OBJECT_KEYS
    && keys.every((key) => utf8.encode(key).byteLength <= MAX_STRING_BYTES
      && globallyBounded(object[key], depth + 1));
}

/** Closed body boundary for the dedicated native owner principal at /mcp. */
export function validateIndexAppOwnerMcpEnvelope(value: unknown): boolean {
  if (!globallyBounded(value) || !value || Array.isArray(value) || typeof value !== 'object') return false;
  let serialized: string;
  try { serialized = JSON.stringify(value); } catch { return false; }
  if (utf8.encode(serialized).byteLength > MAX_SERIALIZED_BYTES) return false;

  const envelope = value as Record<string, unknown>;
  if (!exactKeys(envelope, ['jsonrpc', 'id', 'method', 'params'])
      || envelope.jsonrpc !== '2.0'
      || typeof envelope.id !== 'string' || envelope.id.length < 1 || envelope.id.length > 128
      || envelope.method !== 'tools/call'
      || !envelope.params || Array.isArray(envelope.params) || typeof envelope.params !== 'object') return false;
  const params = envelope.params as Record<string, unknown>;
  if (!exactKeys(params, ['name', 'arguments']) || params.name !== 'create_intent'
      || !params.arguments || Array.isArray(params.arguments) || typeof params.arguments !== 'object') return false;
  const args = params.arguments as Record<string, unknown>;
  const keys = Object.keys(args);
  return keys.length >= 1 && keys.length <= 2
    && keys.includes('description')
    && keys.every((key) => key === 'description' || key === 'autoApprove')
    && typeof args.description === 'string'
    && args.description.trim().length > 0
    && utf8.encode(args.description).byteLength <= MAX_STRING_BYTES
    && (!Object.prototype.hasOwnProperty.call(args, 'autoApprove') || typeof args.autoApprove === 'boolean');
}
