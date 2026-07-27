import type { NegotiationInboxItem, NegotiationInboxStatus } from '@/lib/negotiation-inbox';

// Copied from NegotiationsInbox.tsx so the /chat tab renders the same chips as
// the inbox without the two surfaces diverging. NegotiationsInbox keeps its
// local copies for now; dedupe into this module is a follow-up cleanup.
export const CHIP_CLASS: Record<NegotiationInboxStatus, string> = {
  answer: 'border-[#041729] bg-[#041729] text-white',
  agreed: 'border-emerald-200 bg-emerald-50 text-emerald-700',
  live: 'border-amber-200 bg-amber-50 text-amber-700',
  waiting: 'border-gray-200 bg-gray-100 text-gray-600',
  accepted: 'border-emerald-200 bg-emerald-50 text-emerald-700',
  started: 'border-emerald-200 bg-emerald-50 text-emerald-700',
  rejected: 'border-red-200 bg-red-50 text-red-700',
  stalled: 'border-amber-200 bg-amber-50 text-amber-700',
};

export function statusLabel(item: NegotiationInboxItem): string {
  switch (item.status) {
    case 'answer': return 'Answer your agent';
    case 'agreed': return 'Agents agreed';
    case 'live': return `● Live · turn ${item.turnCount} of ${item.maxTurns}`;
    case 'waiting': return 'Waiting on their agent';
    case 'accepted': return 'Accepted by you';
    case 'started': return 'Chat started';
    case 'rejected': return 'No opportunity';
    case 'stalled': return 'Stalled';
  }
}
