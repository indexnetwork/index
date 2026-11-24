/**
 * Event kinds used by Index on Nostr.
 *
 * Index's own kinds sit outside the upstream NIP registry and outside Buzz's
 * reserved 40000–49999 range (checked against both on 2026-11-17). See
 * `nips/NIP-IX.md` for the wire format of each kind.
 */
export const KIND = {
  /** Index intent. Addressable (`d` = intent id). Plain for public and network-only intents, gift-wrapped otherwise. */
  INTENT: 31641,
  /** Index host opens a negotiation between two intents. Signed by the host, gift-wrapped to each seat. */
  NEGOTIATION_OPEN: 4641,
  /** One negotiation turn. Signed by the seat (the owner, or an agent attested with NIP-OA), gift-wrapped. */
  NEGOTIATION_TURN: 4642,
  /** An opportunity, framed for one party. Signed by the host, gift-wrapped to that party's own key. */
  OPPORTUNITY: 4643,
  /** A human's accept or decline of an opportunity. Signed by the owner key only, gift-wrapped to the host. */
  OPPORTUNITY_RESPONSE: 4644,
  /** The host's verdict on a turn or an opportunity. Signed by the host, gift-wrapped. */
  HOST_STATUS: 4645,

  // Standard kinds Index relies on.
  PROFILE: 0,
  DELETION: 5,
  GROUP_CHAT: 9,
  SEAL: 13,
  PRIVATE_DM: 14,
  GIFT_WRAP: 1059,
  RELAY_LIST: 10002,
  DM_RELAY_LIST: 10050,
  CLIENT_AUTH: 22242,
  HTTP_AUTH: 27235,

  // NIP-29 relay-based groups (Index networks, Buzz communities and channels).
  GROUP_PUT_USER: 9000,
  GROUP_REMOVE_USER: 9001,
  GROUP_EDIT_METADATA: 9002,
  GROUP_CREATE: 9007,
  GROUP_JOIN_REQUEST: 9021,
  GROUP_LEAVE_REQUEST: 9022,
  GROUP_METADATA: 39000,
  GROUP_ADMINS: 39001,
  GROUP_MEMBERS: 39002,
} as const;

/** Index-defined kinds, for relay allowlists and collision checks. */
export const INDEX_KINDS: readonly number[] = [
  KIND.INTENT,
  KIND.NEGOTIATION_OPEN,
  KIND.NEGOTIATION_TURN,
  KIND.OPPORTUNITY,
  KIND.OPPORTUNITY_RESPONSE,
  KIND.HOST_STATUS,
];

/** Kinds that only ever travel inside a gift wrap. A relay must refuse them in the clear. */
export const WRAPPED_ONLY_KINDS: readonly number[] = [
  KIND.NEGOTIATION_OPEN,
  KIND.NEGOTIATION_TURN,
  KIND.OPPORTUNITY,
  KIND.OPPORTUNITY_RESPONSE,
  KIND.HOST_STATUS,
];
