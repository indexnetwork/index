/**
 * API compatibility seam for the protocol-owned canonical speaker resolver.
 * Keep API consumers on one implementation rather than copying turn semantics.
 *
 * `expectedNegotiationSpeaker` must be given ONE negotiation's messages, not a
 * whole conversation — use `readNegotiationMessages` to fetch them. Every
 * surface has to agree on that scope: if the graph and the respond/polling
 * surfaces disagreed, an external agent would be told it is not its turn
 * forever.
 */
export {
  expectedNegotiationSpeaker,
  negotiationScopeKey,
  readNegotiationMessages,
} from '@indexnetwork/protocol';
export type {
  NegotiationSpeakerParticipants as NegotiationSpeakerMetadata,
  NegotiationSpeakerMessage,
  NegotiationScopeMetadata,
} from '@indexnetwork/protocol';
