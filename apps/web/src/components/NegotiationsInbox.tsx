import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { Loader2 } from 'lucide-react';

import { ContentContainer } from '@/components/layout';
import UserAvatar from '@/components/UserAvatar';
import { useAuthContext } from '@/contexts/AuthContext';
import { useConversation } from '@/contexts/ConversationContext';
import { deriveNegotiationInbox, flattenNegotiationInbox, type NegotiationInboxItem, type NegotiationInboxStatus } from '@/lib/negotiation-inbox';
import { getNegotiatorDmSessionId } from '@/lib/negotiator-dm';

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

type ViewMode = 'grouped' | 'last-updated';
const VIEW_MODE_STORAGE_KEY = 'negotiations-view-mode';

function readViewMode(): ViewMode {
  try {
    return window.localStorage.getItem(VIEW_MODE_STORAGE_KEY) === 'last-updated' ? 'last-updated' : 'grouped';
  } catch {
    return 'grouped';
  }
}

// 1.6s update flash on changed rows (design §3 R2): amber-tinted for content
// updates, steel-tinted for posture moves. Keyed per-flash so the overlay
// remounts and restarts the animation on consecutive updates.
const FLASH_STYLES = `
@keyframes negotiations-flash-amber { from { background: #fff3d6; } to { background: transparent; } }
@keyframes negotiations-flash-steel { from { background: #dceefb; } to { background: transparent; } }
.negotiations-flash-amber { animation: negotiations-flash-amber 1.6s ease-out; }
.negotiations-flash-steel { animation: negotiations-flash-steel 1.6s ease-out; }
`;

interface RowFlash {
  kind: 'amber' | 'steel';
  nonce: number;
}

function NegotiationRow({ item, flash, rowRef, onOpen }: {
  item: NegotiationInboxItem;
  flash?: RowFlash;
  rowRef?: (element: HTMLButtonElement | null) => void;
  onOpen: (item: NegotiationInboxItem) => void;
}) {
  const isResolved = item.group === 'resolved';

  return (
    <button
      type="button"
      ref={rowRef}
      onClick={() => onOpen(item)}
      className={`group relative flex w-full flex-wrap items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-gray-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#4091BB] sm:flex-nowrap ${isResolved ? 'bg-gray-50/60 opacity-80' : 'bg-white'}`}
      aria-label={`Open negotiation with ${item.counterpart.name}`}
    >
      {flash && (
        <span
          key={flash.nonce}
          aria-hidden="true"
          className={`pointer-events-none absolute inset-0 ${flash.kind === 'steel' ? 'negotiations-flash-steel' : 'negotiations-flash-amber'}`}
        />
      )}
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

function InboxGroup({ label, items, flashes, onOpen }: {
  label: string;
  items: NegotiationInboxItem[];
  flashes: ReadonlyMap<string, RowFlash>;
  onOpen: (item: NegotiationInboxItem) => void;
}) {
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
          {items.map((item) => <NegotiationRow key={item.conversationId} item={item} flash={flashes.get(item.conversationId)} onOpen={onOpen} />)}
        </div>
      )}
    </section>
  );
}

export default function NegotiationsInbox() {
  const navigate = useNavigate();
  const { user, features } = useAuthContext();
  const { negotiations, refreshNegotiations, isConnected } = useConversation();
  const [refreshing, setRefreshing] = useState(negotiations.length === 0);
  const [viewMode, setViewMode] = useState<ViewMode>(readViewMode);
  const [now, setNow] = useState(() => Date.now());
  const [flashes, setFlashes] = useState<ReadonlyMap<string, RowFlash>>(new Map());
  const previousRowsRef = useRef<Map<string, { group: string; status: string; sortTimestamp: number }> | null>(null);
  const flashTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const flashNonceRef = useRef(0);
  const flatListRef = useRef<HTMLDivElement | null>(null);
  const rowElementsRef = useRef(new Map<string, HTMLButtonElement>());
  const previousTopsRef = useRef(new Map<string, number>());

  useEffect(() => {
    let cancelled = false;
    refreshNegotiations().finally(() => {
      if (!cancelled) setRefreshing(false);
    });
    return () => { cancelled = true; };
  }, [refreshNegotiations]);

  // Ticking relative timestamps (design §3 R5): re-derive "Xm ago" every 30s.
  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(interval);
  }, []);

  const groups = useMemo(
    () => deriveNegotiationInbox(negotiations, user?.id, now),
    [negotiations, user?.id, now],
  );
  const flatItems = useMemo(() => flattenNegotiationInbox(groups), [groups]);
  const totalCount = groups.yourMove.length + groups.inProgress.length + groups.resolved.length;

  // "Answer your agent" rows deep-link to the negotiator DM — the transcript
  // is read-only and can't take an answer. /questions is the fallback when
  // the negotiator surface is unavailable (IND-558).
  const openNegotiation = useCallback((item: NegotiationInboxItem) => {
    if (item.status !== 'answer') {
      navigate(`/chat/${item.conversationId}`);
      return;
    }
    if (!features?.negotiatorChat) {
      navigate('/questions');
      return;
    }
    void getNegotiatorDmSessionId().then((sessionId) => {
      navigate(sessionId ? `/d/${sessionId}` : '/questions');
    });
  }, [navigate, features]);

  // Diff each refetch against the previous rows and flash what changed
  // (design §3 R2): posture moves (group/status) in steel, content updates
  // (a turn landed → updatedAt moved) and new arrivals in amber.
  useEffect(() => {
    const previous = previousRowsRef.current;
    previousRowsRef.current = new Map(
      flatItems.map((item) => [item.conversationId, { group: item.group, status: item.status, sortTimestamp: item.sortTimestamp }]),
    );
    if (!previous) return;

    const changed: Array<[string, RowFlash['kind']]> = [];
    for (const item of flatItems) {
      const before = previous.get(item.conversationId);
      if (!before) changed.push([item.conversationId, 'amber']);
      else if (before.group !== item.group || before.status !== item.status) changed.push([item.conversationId, 'steel']);
      else if (before.sortTimestamp !== item.sortTimestamp) changed.push([item.conversationId, 'amber']);
    }
    if (changed.length === 0) return;

    flashNonceRef.current += 1;
    const nonce = flashNonceRef.current;
    setFlashes(new Map(changed.map(([id, kind]) => [id, { kind, nonce }])));
    if (flashTimeoutRef.current) clearTimeout(flashTimeoutRef.current);
    flashTimeoutRef.current = setTimeout(() => {
      flashTimeoutRef.current = null;
      setFlashes(new Map());
    }, 1600);
    return () => {
      if (flashTimeoutRef.current) clearTimeout(flashTimeoutRef.current);
    };
  }, [flatItems]);

  // FLIP reorder in Last updated mode (design §3 R2): stable keys keep rows
  // mounted; offset each moved row back to its previous spot, then transition
  // to the new one so reorders glide instead of vanishing/reappearing.
  useLayoutEffect(() => {
    if (viewMode !== 'last-updated' || !flatListRef.current) return;
    const listTop = flatListRef.current.getBoundingClientRect().top;
    rowElementsRef.current.forEach((element, id) => {
      const top = element.getBoundingClientRect().top - listTop;
      const previousTop = previousTopsRef.current.get(id);
      if (previousTop !== undefined && previousTop !== top) {
        element.style.transition = 'none';
        element.style.transform = `translateY(${previousTop - top}px)`;
        requestAnimationFrame(() => {
          element.style.transition = 'transform 0.3s ease';
          element.style.transform = '';
        });
      }
      previousTopsRef.current.set(id, top);
    });
  });

  const selectViewMode = (mode: ViewMode) => {
    setViewMode(mode);
    try {
      window.localStorage.setItem(VIEW_MODE_STORAGE_KEY, mode);
    } catch {
      // Storage unavailable — keep the in-memory choice.
    }
  };

  return (
    <div className="px-6 pb-12 lg:px-8">
      <style>{FLASH_STYLES}</style>
      <ContentContainer className="text-left" size="wide">
        <div className="mb-6 mt-12 text-center">
          <h1 className="text-[28px] font-bold text-black font-ibm-plex-mono">Negotiations</h1>
          <p className="mt-2 text-xs text-gray-400 font-ibm-plex-mono">
            {groups.yourMove.length} your move · {groups.inProgress.length} in progress · {groups.resolved.length} resolved
            <span className="ml-3 inline-flex items-center gap-1.5" role="status">
              <span className={`h-1.5 w-1.5 rounded-full ${isConnected ? 'bg-emerald-500' : 'bg-gray-400'}`} aria-hidden="true" />
              {isConnected ? 'live' : 'reconnecting…'}
            </span>
          </p>
          <div className="mx-auto mt-4 flex w-full max-w-[300px] items-center gap-1 rounded-md bg-gray-100 p-0.5" aria-label="View mode">
            <button
              type="button"
              onClick={() => selectViewMode('grouped')}
              aria-pressed={viewMode === 'grouped'}
              className={`flex-1 text-xs font-semibold py-1.5 rounded transition-colors font-ibm-plex-mono ${viewMode === 'grouped' ? 'bg-white text-black shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
            >
              Grouped
            </button>
            <button
              type="button"
              onClick={() => selectViewMode('last-updated')}
              aria-pressed={viewMode === 'last-updated'}
              className={`flex-1 text-xs font-semibold py-1.5 rounded transition-colors font-ibm-plex-mono ${viewMode === 'last-updated' ? 'bg-white text-black shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
            >
              Last updated
            </button>
          </div>
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
        ) : viewMode === 'grouped' ? (
          <div className="space-y-8">
            <InboxGroup label="Your move" items={groups.yourMove} flashes={flashes} onOpen={openNegotiation} />
            <InboxGroup label="In progress" items={groups.inProgress} flashes={flashes} onOpen={openNegotiation} />
            <InboxGroup label="Resolved" items={groups.resolved} flashes={flashes} onOpen={openNegotiation} />
          </div>
        ) : (
          <div ref={flatListRef} className="divide-y divide-gray-100 overflow-hidden rounded-md border border-gray-200 bg-white">
            {flatItems.map((item) => (
              <NegotiationRow
                key={item.conversationId}
                item={item}
                flash={flashes.get(item.conversationId)}
                onOpen={openNegotiation}
                rowRef={(element) => {
                  if (element) rowElementsRef.current.set(item.conversationId, element);
                  else rowElementsRef.current.delete(item.conversationId);
                }}
              />
            ))}
          </div>
        )}
      </ContentContainer>
    </div>
  );
}
