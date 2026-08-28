import { Link } from "react-router";

import type { NegotiationTaskIndexEntry } from "@/services/conversation";

function pauseLabel(entry: NegotiationTaskIndexEntry): string | null {
  if (!entry.pause) return null;
  const owner = entry.pause.by === 'yours' ? 'your agent' : entry.pause.by === 'theirs' ? 'their agent' : 'unknown seat';
  return `${entry.pause.reason.replace(/_/g, ' ')} · ${owner}`;
}

function latestLabel(entry: NegotiationTaskIndexEntry): string {
  if (!entry.latestActivity.createdAt) return 'No shared A2A turn recorded.';
  const actor = entry.latestActivity.actor === 'yours' ? 'Your agent' : 'Their agent';
  const verb = entry.latestActivity.verb?.replace(/_/g, ' ') ?? 'event';
  return `${actor} · ${verb} · ${new Date(entry.latestActivity.createdAt).toLocaleString()}`;
}

export default function NegotiationTaskIndex({ entries }: { entries: NegotiationTaskIndexEntry[] }) {
  if (entries.length === 0) {
    return <p className="rounded-lg border border-dashed border-gray-200 px-4 py-10 text-center font-ibm-plex-mono text-sm text-gray-500">No negotiation seats are recorded for this owner.</p>;
  }
  return (
    <ol className="space-y-3" aria-label="Negotiation task index">
      {entries.map((entry) => (
        <li key={`${entry.taskId}:${entry.intentId}`} className="rounded-lg border border-gray-200 bg-white p-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-sm font-semibold text-gray-900">{entry.counterpartLabel}</p>
              <p className="mt-1 truncate font-ibm-plex-mono text-[11px] text-slate-600">intent · {entry.intentLabel}</p>
              <p className="mt-1 font-ibm-plex-mono text-[10px] text-gray-500">batch {entry.batchId ? entry.batchId.slice(0, 8) : 'none'} · task {entry.state} · opportunity {entry.opportunityStatus}</p>
            </div>
            <Link to={`/i/${entry.intentId}/negotiations/${entry.taskId}`} className="text-xs font-medium text-[#35799C] hover:underline">Inspect seat</Link>
          </div>
          <p className="mt-3 text-xs text-gray-700">{latestLabel(entry)}</p>
          {pauseLabel(entry) && <p className="mt-1 font-ibm-plex-mono text-[10px] text-amber-700">pause · {pauseLabel(entry)}</p>}
          <p className="mt-2 font-ibm-plex-mono text-[10px] text-gray-400" title={`task ${entry.taskId} · opportunity ${entry.opportunityId} · intent ${entry.intentId}`}>
            task {entry.taskId} · opportunity {entry.opportunityId} · intent {entry.intentId}
          </p>
        </li>
      ))}
    </ol>
  );
}
