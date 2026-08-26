import { Link } from "react-router";

import UserAvatar from "@/components/UserAvatar";
import { deriveTaskIndexInbox, type TaskIndexInboxItem } from "@/lib/negotiation-inbox";
import { presentationForStatus } from "@/lib/negotiation-presentation";
import type { NegotiationTaskIndexEntry } from "@/services/conversation";

function StatusChip({ item }: { item: TaskIndexInboxItem }) {
  const presentation = presentationForStatus(item.status);
  return (
    <span className={`inline-flex shrink-0 items-center whitespace-nowrap rounded-full border px-2.5 py-1 text-[10px] font-semibold font-ibm-plex-mono ${presentation.chipClass}`}>
      {presentation.label}
    </span>
  );
}

function NegotiationRow({ item }: { item: TaskIndexInboxItem }) {
  const isResolved = item.group === "resolved";
  return (
    <Link
      to={`/i/${item.intentId}/negotiations/${item.taskId}`}
      className={`group flex w-full flex-wrap items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-gray-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#4091BB] sm:flex-nowrap ${isResolved ? "bg-gray-50/60 opacity-80" : "bg-white"}`}
      aria-label={`Open negotiation with ${item.counterpartName} about ${item.intentLabel}`}
    >
      <UserAvatar id={item.counterpartName} name={item.counterpartName} avatar={null} size={28} className="shrink-0" />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-semibold text-[#041729] font-ibm-plex-mono">{item.counterpartName}</p>
        <p className="mt-0.5 truncate text-xs text-gray-400 font-ibm-plex-mono">
          {item.intentLabel} · {item.lastAction} · {item.timeAgo}
        </p>
      </div>
      <div className="ml-auto flex shrink-0 items-center gap-2">
        <StatusChip item={item} />
        {item.status === "awaiting_review" && (
          <span className="rounded-sm bg-[#041729] px-3 py-1.5 text-xs font-semibold text-white">Review</span>
        )}
        {item.status === "negotiating" && (
          <span className="h-2 w-2 rounded-full bg-amber-400 animate-pulse" aria-hidden="true" />
        )}
      </div>
    </Link>
  );
}

function InboxGroup({ label, items }: { label: string; items: TaskIndexInboxItem[] }) {
  if (items.length === 0) return null;
  return (
    <section aria-labelledby={`negotiations-${label.toLowerCase().replace(/\s+/g, "-")}`}>
      <h2
        id={`negotiations-${label.toLowerCase().replace(/\s+/g, "-")}`}
        className="mb-2 font-ibm-plex-mono text-[10px] font-semibold uppercase tracking-[0.18em] text-gray-400"
      >
        {label} · {items.length}
      </h2>
      <div className="divide-y divide-gray-100 overflow-hidden rounded-md border border-gray-200 bg-white">
        {items.map((item) => <NegotiationRow key={item.key} item={item} />)}
      </div>
    </section>
  );
}

export default function NegotiationTaskIndex({
  entries,
  loading,
  error,
}: {
  entries: NegotiationTaskIndexEntry[];
  loading: boolean;
  error: boolean;
}) {
  const groups = deriveTaskIndexInbox(entries);
  const totalCount = groups.yourMove.length + groups.inProgress.length + groups.resolved.length;

  return (
    <div>
      <div className="mb-6 mt-12 text-center">
        <h1 className="text-[28px] font-bold text-black font-ibm-plex-mono">Negotiations</h1>
        <p className="mt-2 text-xs text-gray-400 font-ibm-plex-mono">
          {groups.yourMove.length} your move · {groups.inProgress.length} in progress · {groups.resolved.length} resolved
        </p>
      </div>

      {loading && totalCount === 0 ? (
        <p className="py-16 text-center text-sm text-gray-500">Loading negotiations…</p>
      ) : error ? (
        <p className="text-center text-sm text-red-600">Negotiations could not be loaded.</p>
      ) : totalCount === 0 ? (
        <div className="rounded-md border border-dashed border-gray-200 py-12 text-center text-sm text-gray-500 font-ibm-plex-mono">
          <p>No negotiations yet</p>
          <p className="mt-2 text-xs text-gray-400">Your agents' connection work will appear here.</p>
        </div>
      ) : (
        <div className="space-y-8" aria-label="Negotiations">
          <InboxGroup label="Your move" items={groups.yourMove} />
          <InboxGroup label="In progress" items={groups.inProgress} />
          <InboxGroup label="Resolved" items={groups.resolved} />
        </div>
      )}
    </div>
  );
}
