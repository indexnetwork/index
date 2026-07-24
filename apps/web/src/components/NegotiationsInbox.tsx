import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import { Loader2 } from 'lucide-react';

import { ContentContainer } from '@/components/layout';
import UserAvatar from '@/components/UserAvatar';
import { useAuthContext } from '@/contexts/AuthContext';
import { useConversation } from '@/contexts/ConversationContext';
import { deriveNegotiationInbox, type NegotiationInboxItem, type NegotiationInboxStatus } from '@/lib/negotiation-inbox';

const CHIP_CLASS: Record<NegotiationInboxStatus, string> = {
  answer: 'border-[#041729] bg-[#041729] text-white',
  agreed: 'border-emerald-200 bg-emerald-50 text-emerald-700',
  live: 'border-amber-200 bg-amber-50 text-amber-700',
  waiting: 'border-gray-200 bg-gray-100 text-gray-600',
  accepted: 'border-emerald-200 bg-emerald-50 text-emerald-700',
  started: 'border-emerald-200 bg-emerald-50 text-emerald-700',
  rejected: 'border-red-200 bg-red-50 text-red-700',
  stalled: 'border-amber-200 bg-amber-50 text-amber-700',
};

function statusLabel(item: NegotiationInboxItem): string {
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

function StatusChip({ item }: { item: NegotiationInboxItem }) {
  return (
    <span className={`inline-flex shrink-0 items-center whitespace-nowrap rounded-full border px-2.5 py-1 text-[10px] font-semibold font-ibm-plex-mono ${CHIP_CLASS[item.status]}`}>
      {statusLabel(item)}
    </span>
  );
}

function NegotiationRow({ item }: { item: NegotiationInboxItem }) {
  const navigate = useNavigate();
  const openTranscript = () => navigate(`/chat/${item.conversationId}`);
  const isResolved = item.group === 'resolved';

  return (
    <button
      type="button"
      onClick={openTranscript}
      className={`group flex w-full flex-wrap items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-gray-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#4091BB] sm:flex-nowrap ${isResolved ? 'bg-gray-50/60 opacity-80' : 'bg-white'}`}
      aria-label={`Open negotiation with ${item.counterpart.name}`}
    >
      <UserAvatar
        id={item.counterpart.id}
        name={item.counterpart.name}
        avatar={item.counterpart.avatar}
        size={28}
        className="shrink-0"
      />

      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-semibold text-[#041729] font-ibm-plex-mono">
          {item.counterpart.name}
        </p>
        <p className="mt-0.5 truncate text-xs text-gray-400 font-ibm-plex-mono">
          {item.signalCount} mutual {item.signalCount === 1 ? 'signal' : 'signals'} · {item.lastAction} · {item.timeAgo}
        </p>
      </div>

      <div className="ml-auto flex shrink-0 items-center gap-2">
        <StatusChip item={item} />
        {item.status === 'agreed' && (
          <span className="rounded-sm bg-[#041729] px-3 py-1.5 text-xs font-semibold text-white">
            Review
          </span>
        )}
        {(item.status === 'live' || item.status === 'waiting') && (
          <span className="h-2 w-2 rounded-full bg-amber-400 animate-pulse" aria-hidden="true" />
        )}
      </div>
    </button>
  );
}

function InboxGroup({ label, items }: { label: string; items: NegotiationInboxItem[] }) {
  return (
    <section aria-labelledby={`negotiations-${label.toLowerCase().replace(/\s+/g, '-')}`}>
      <h2
        id={`negotiations-${label.toLowerCase().replace(/\s+/g, '-')}`}
        className="mb-2 font-ibm-plex-mono text-[10px] font-semibold uppercase tracking-[0.18em] text-gray-400"
      >
        {label} · {items.length}
      </h2>
      {items.length > 0 && (
        <div className="divide-y divide-gray-100 overflow-hidden rounded-md border border-gray-200 bg-white">
          {items.map((item) => <NegotiationRow key={item.conversationId} item={item} />)}
        </div>
      )}
    </section>
  );
}

export default function NegotiationsInbox() {
  const { user } = useAuthContext();
  const { negotiations, refreshNegotiations } = useConversation();
  const [refreshing, setRefreshing] = useState(negotiations.length === 0);

  useEffect(() => {
    let cancelled = false;
    refreshNegotiations().finally(() => {
      if (!cancelled) setRefreshing(false);
    });
    return () => { cancelled = true; };
  }, [refreshNegotiations]);

  const groups = useMemo(
    () => deriveNegotiationInbox(negotiations, user?.id),
    [negotiations, user?.id],
  );
  const totalCount = groups.yourMove.length + groups.inProgress.length + groups.resolved.length;

  return (
    <div className="px-6 pb-12 lg:px-8">
      <ContentContainer className="text-left" size="wide">
        <div className="mb-6 mt-12 text-center">
          <h1 className="text-[28px] font-bold text-black font-ibm-plex-mono">Negotiations</h1>
          <p className="mt-2 text-xs text-gray-400 font-ibm-plex-mono">
            {groups.yourMove.length} your move · {groups.inProgress.length} in progress · {groups.resolved.length} resolved
          </p>
        </div>

        {refreshing && totalCount === 0 ? (
          <div className="flex justify-center py-16" aria-label="Loading negotiations">
            <Loader2 className="h-5 w-5 animate-spin text-gray-400" />
          </div>
        ) : totalCount === 0 ? (
          <div className="rounded-md border border-dashed border-gray-200 py-12 text-center text-sm text-gray-500 font-ibm-plex-mono">
            <p>No negotiations yet</p>
            <p className="mt-2 text-xs text-gray-400">Your agents’ connection work will appear here.</p>
          </div>
        ) : (
          <div className="space-y-8">
            <InboxGroup label="Your move" items={groups.yourMove} />
            <InboxGroup label="In progress" items={groups.inProgress} />
            <InboxGroup label="Resolved" items={groups.resolved} />
          </div>
        )}
      </ContentContainer>
    </div>
  );
}
