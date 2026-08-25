import type { IntentCycleNegotiationDetail } from "@/services/conversation";

function payload(value: unknown): string {
  return JSON.stringify(value, null, 2);
}

function pauseLabel(reason: string): string {
  if (reason === "open_failed") return "agent response failed";
  return reason.replace(/_/g, " ");
}

const PAUSED_NEGOTIATION_EXPIRE_AFTER_MS = 12 * 60 * 60 * 1000;

function expiresIn(updatedAt: string): string {
  const remainingMs = Math.max(0, new Date(updatedAt).getTime() + PAUSED_NEGOTIATION_EXPIRE_AFTER_MS - Date.now());
  const hours = Math.floor(remainingMs / (60 * 60 * 1000));
  const minutes = Math.ceil((remainingMs % (60 * 60 * 1000)) / (60 * 1000));
  return hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`;
}

export default function IntentNegotiationInspector({ detail }: { detail: IntentCycleNegotiationDetail }) {
  return (
    <div className="space-y-4" aria-label="Negotiation inspector">
      <section className="rounded-lg border border-slate-200 bg-slate-50 p-4">
        <p className="font-ibm-plex-mono text-[10px] uppercase tracking-[0.12em] text-slate-500">Your negotiation context</p>
        <dl className="mt-3 grid gap-3 text-sm">
          <div>
            <dt className="font-ibm-plex-mono text-[10px] uppercase tracking-[0.12em] text-gray-500">Your actual intent</dt>
            <dd className="mt-1 whitespace-pre-wrap text-gray-900">{detail.intent.payload}</dd>
          </div>
          <div>
            <dt className="font-ibm-plex-mono text-[10px] uppercase tracking-[0.12em] text-gray-500">Your seat brief</dt>
            <dd className="mt-1 whitespace-pre-wrap text-gray-800">{detail.task.brief ?? "No brief has been written for this seat."}</dd>
          </div>
        </dl>
      </section>

      <section className="rounded-lg border border-gray-200 bg-white p-4">
        <p className="font-ibm-plex-mono text-[10px] uppercase tracking-[0.12em] text-gray-500">Task state</p>
        <p className="mt-2 text-sm text-gray-900">round {detail.task.round} · {detail.task.state}</p>
        <p className="mt-1 font-ibm-plex-mono text-[10px] text-gray-500">task {detail.task.id} · opportunity {detail.task.opportunityId}</p>
        {detail.task.pause && (
          <div className="mt-3 rounded border border-amber-200 bg-amber-50 p-3">
            <p className="text-xs font-medium text-amber-900">Paused · {pauseLabel(detail.task.pause.reason)} · {detail.task.pause.by === 'yours' ? 'your agent' : detail.task.pause.by === 'theirs' ? 'their agent' : 'unknown seat'}</p>
            {(detail.task.pause.reason === 'needs_principal' || detail.task.pause.reason === 'counterparty_silent') && (
              <p className="mt-1 text-xs text-amber-800">Expires in {expiresIn(detail.task.updatedAt)}</p>
            )}
            {detail.task.pause.payload !== undefined && (
              <pre className="mt-2 overflow-x-auto whitespace-pre-wrap font-ibm-plex-mono text-[11px] text-amber-950">{payload(detail.task.pause.payload)}</pre>
            )}
          </div>
        )}
      </section>

      {detail.outcome && (
        <section className="rounded-lg border border-emerald-200 bg-emerald-50 p-4">
          <p className="font-ibm-plex-mono text-[10px] uppercase tracking-[0.12em] text-emerald-700">Your agent's outcome</p>
          <p className="mt-2 text-sm font-medium text-emerald-950">{detail.outcome.verdict}</p>
          {detail.outcome.reasoning && <p className="mt-1 whitespace-pre-wrap text-sm text-emerald-900">{detail.outcome.reasoning}</p>}
        </section>
      )}

      <section className="rounded-lg border border-gray-200 bg-white p-4">
        <p className="font-ibm-plex-mono text-[10px] uppercase tracking-[0.12em] text-gray-500">Shared A2A transcript</p>
        {detail.transcript.length === 0 ? (
          <p className="mt-3 text-sm text-gray-500">No turns recorded.</p>
        ) : (
          <ol className="mt-3 space-y-3">
            {detail.transcript.map((turn) => (
              <li key={turn.id} className="border-l-2 border-gray-200 pl-3">
                <p className="font-ibm-plex-mono text-[10px] uppercase tracking-[0.12em] text-gray-500">
                  {turn.actor === 'yours' ? 'Your agent' : 'Their agent'} · {turn.pause ? `paused: ${pauseLabel(turn.pause.reason)}` : turn.verb ?? 'event'}
                </p>
                {turn.text && <p className="mt-1 whitespace-pre-wrap text-sm text-gray-800">{turn.text}</p>}
                {turn.pause?.payload !== undefined && <pre className="mt-2 overflow-x-auto whitespace-pre-wrap font-ibm-plex-mono text-[11px] text-gray-700">{payload(turn.pause.payload)}</pre>}
                <time className="mt-1 block font-ibm-plex-mono text-[10px] text-gray-400">{new Date(turn.createdAt).toLocaleString()}</time>
              </li>
            ))}
          </ol>
        )}
      </section>
    </div>
  );
}
