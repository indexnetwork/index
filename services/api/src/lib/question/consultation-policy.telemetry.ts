import type { NegotiationConsultationReason, QuestionerInput } from '@indexnetwork/protocol';

/** Privacy-minimized IND-508 event emitted only after final question persistence. */
export interface ConsultationDeliveredTelemetry {
  stage: 'delivered';
  reason: NegotiationConsultationReason;
}

export type ConsultationPersistenceOutcome =
  | { state: 'persisted'; ids: readonly string[] }
  | { state: 'no_rows' | 'rejected' | 'failed' };

/**
 * Emit delivery only after a durable row exists. The policy category is carried
 * through the queue job ephemerally and is never added to question persistence.
 */
export function emitConsultationDeliveredTelemetry(
  data: QuestionerInput,
  outcome: ConsultationPersistenceOutcome,
  emit: (event: ConsultationDeliveredTelemetry) => void,
): void {
  if (outcome.state !== 'persisted' || outcome.ids.length === 0 || data.mode !== 'negotiation_inflight') return;
  const reason = (data.context as { consultationPolicyReason?: NegotiationConsultationReason }).consultationPolicyReason;
  if (reason) emit({ stage: 'delivered', reason });
}
