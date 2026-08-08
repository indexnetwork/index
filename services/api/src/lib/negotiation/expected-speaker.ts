/**
 * API compatibility seam for the protocol-owned canonical speaker resolver.
 * Keep API consumers on one implementation rather than copying turn semantics.
 */
export { expectedNegotiationSpeaker } from '@indexnetwork/protocol';
export type {
  NegotiationSpeakerParticipants as NegotiationSpeakerMetadata,
  NegotiationSpeakerMessage,
} from '@indexnetwork/protocol';
