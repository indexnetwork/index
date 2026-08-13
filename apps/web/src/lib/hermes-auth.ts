export const HERMES_CAPABILITIES = [
  { action: 'manage:identity', label: 'Keep your Index identity up to date' },
  { action: 'manage:premises', label: 'Manage the facts and context you share with Index' },
  { action: 'manage:intents', label: 'Create and manage your intents' },
  { action: 'manage:networks', label: 'Manage your network memberships and connections' },
  { action: 'manage:opportunities', label: 'Review and act on opportunities' },
  { action: 'manage:negotiations', label: 'Handle negotiations on your behalf' },
] as const;

export type HermesCapabilityAction = (typeof HERMES_CAPABILITIES)[number]['action'];
