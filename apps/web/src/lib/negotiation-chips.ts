import type { NegotiationInboxItem, NegotiationInboxStatus } from '@/lib/negotiation-inbox';
import { presentationForStatus } from '@/lib/negotiation-presentation';

export function chipClass(status: NegotiationInboxStatus): string {
  return presentationForStatus(status).chipClass;
}

export function statusLabel(item: NegotiationInboxItem): string {
  return presentationForStatus(item.status).label;
}
