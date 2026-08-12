export const HERMES_CANONICAL_ACTIONS = [
  'manage:identity',
  'manage:premises',
  'manage:intents',
  'manage:networks',
  'manage:opportunities',
  'manage:negotiations',
] as const;

export type HermesCapability = typeof HERMES_CANONICAL_ACTIONS[number];

const canonical = new Set<string>(HERMES_CANONICAL_ACTIONS);

/**
 * Canonicalize durable Hermes actions. The retired profile action is accepted
 * only as legacy migration input; retired contacts is never representable.
 */
export function normalizeHermesCapabilities(actions: readonly string[]): HermesCapability[] {
  const normalized = new Set<HermesCapability>();
  for (const action of actions) {
    if (action === 'manage:contacts') throw new Error('retired_action');
    if (action === 'manage:profile') {
      normalized.add('manage:identity');
      normalized.add('manage:premises');
      continue;
    }
    if (!canonical.has(action)) throw new Error('unknown_action');
    normalized.add(action as HermesCapability);
  }
  return HERMES_CANONICAL_ACTIONS.filter((action) => normalized.has(action));
}

/** True only for the complete, duplicate-free standalone Hermes grant. */
export function isExactHermesCapabilitySet(actions: readonly string[]): actions is HermesCapability[] {
  return actions.length === HERMES_CANONICAL_ACTIONS.length
    && new Set(actions).size === HERMES_CANONICAL_ACTIONS.length
    && HERMES_CANONICAL_ACTIONS.every((action) => actions.includes(action));
}
