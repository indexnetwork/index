import type { IntentCycleTimelineEntry } from "@/services/conversation";

function json(value: Record<string, unknown>): string {
  return JSON.stringify(value, null, 2);
}

function actDetail(act: Record<string, unknown>): string | null {
  if (typeof act.text === 'string') return act.text;
  if (typeof act.reasoning === 'string') return act.reasoning;
  const parts = [
    typeof act.round === 'number' ? `round ${act.round}` : null,
    typeof act.opened === 'number' ? `${act.opened} opened` : null,
    typeof act.negotiationId === 'string' ? `negotiation ${act.negotiationId}` : null,
    typeof act.opportunityId === 'string' ? `opportunity ${act.opportunityId}` : null,
    typeof act.outcome === 'string' ? act.outcome : null,
  ].filter((part): part is string => part !== null);
  return parts.length > 0 ? parts.join(' · ') : null;
}

export default function PersonalAgentTimeline({
  entries,
  loading,
  error,
}: {
  entries: IntentCycleTimelineEntry[];
  loading: boolean;
  error: boolean;
}) {
  return (
    <section className="rounded-lg border border-gray-200 bg-white p-3" aria-label="PersonalAgent act timeline">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <p className="font-ibm-plex-mono text-[10px] uppercase tracking-[0.12em] text-gray-500">PersonalAgent acts</p>
          <p className="mt-1 text-xs text-gray-600">Executed effects from the append-only IS-A ledger. Message-user entries may be strategy or ordinary DM copy; the ledger does not label them further.</p>
        </div>
        <p className="font-ibm-plex-mono text-[10px] text-gray-400">latest 100</p>
      </div>
      {loading ? <p role="status" className="mt-3 text-xs text-gray-500">Loading agent acts…</p>
        : error ? <p role="status" className="mt-3 text-xs text-red-600">Agent act ledger could not be loaded.</p>
          : entries.length === 0 ? <p className="mt-3 text-xs text-gray-500">No persisted IS-A acts for this intent. Discovery or a queued wake may not have reached the agent yet.</p>
            : (
              <ol className="mt-3 space-y-3">
                {entries.map((entry) => (
                  <li key={entry.id} className="border-l-2 border-slate-200 pl-3">
                    <p className="font-ibm-plex-mono text-[10px] uppercase tracking-[0.12em] text-slate-600">
                      event {typeof entry.event.kind === 'string' ? entry.event.kind : 'unknown'} → {typeof entry.act.tool === 'string' ? entry.act.tool : 'unknown act'}
                    </p>
                    {actDetail(entry.act) && <p className="mt-1 whitespace-pre-wrap text-xs text-gray-700">{actDetail(entry.act)}</p>}
                    <time className="mt-1 block font-ibm-plex-mono text-[10px] text-gray-400">{new Date(entry.createdAt).toLocaleString()} · {entry.id}</time>
                    <details className="mt-2">
                      <summary className="cursor-pointer text-[11px] text-[#35799C]">Raw event and executed act</summary>
                      <div className="mt-2 grid gap-2 lg:grid-cols-2">
                        <pre className="overflow-x-auto rounded bg-slate-50 p-2 font-ibm-plex-mono text-[10px] text-slate-700">{json(entry.event)}</pre>
                        <pre className="overflow-x-auto rounded bg-slate-50 p-2 font-ibm-plex-mono text-[10px] text-slate-700">{json(entry.act)}</pre>
                      </div>
                    </details>
                  </li>
                ))}
              </ol>
            )}
    </section>
  );
}
