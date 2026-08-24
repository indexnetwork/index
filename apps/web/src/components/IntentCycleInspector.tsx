import { Link } from "react-router";

import type { IntentCycleSnapshot, NegotiationPauseReason } from "@/services/conversation";

function cyclePhase(cycle: IntentCycleSnapshot): { label: string; detail: string; active: number } {
  const { round } = cycle;
  if (round.number === 0) return { label: "Waiting for kickoff", detail: "No negotiation round has been started.", active: 1 };
  if (round.size === null) return { label: `Opening round ${round.number}`, detail: "The agent is creating this round's negotiations.", active: 3 };
  if (round.working > 0) return { label: `Round ${round.number} negotiating`, detail: `${round.working} active · ${round.paused} paused`, active: 4 };
  return { label: `Round ${round.number} ready to reflect`, detail: `${round.paused} paused · the intent agent decides the next step`, active: 5 };
}

function pauseLabel(reason: NegotiationPauseReason, by: 'yours' | 'theirs' | null): string {
  const owner = by === 'yours' ? 'your agent' : by === 'theirs' ? 'their agent' : 'an agent';
  if (reason === 'needs_principal') return `${owner} needs principal input`;
  if (reason === 'ready_for_verdict') return `${owner} requested a verdict`;
  if (reason === 'counterparty_silent') return 'waiting for the counterparty';
  if (reason === 'turn_cap') return 'turn budget paused';
  return 'opening paused';
}

function activityLabel(negotiation: IntentCycleSnapshot['negotiations'][number]): string {
  const activity = negotiation.latestActivity;
  if (!activity) return 'No A2A turn recorded yet.';
  if (activity.verb === 'pause') return negotiation.pause ? pauseLabel(negotiation.pause.reason, negotiation.pause.by) : `${activity.actor === 'yours' ? 'your' : 'their'} agent paused`;
  const actor = activity.actor === 'yours' ? 'Your agent' : 'Their agent';
  const verb = activity.verb ? activity.verb.replace(/_/g, ' ') : 'acted';
  return activity.text ? `${actor} ${verb}: ${activity.text}` : `${actor} ${verb}.`;
}

export default function IntentCycleInspector({
  intentId,
  cycle,
  loading,
  error,
}: {
  intentId: string;
  cycle: IntentCycleSnapshot | null;
  loading: boolean;
  error: boolean;
}) {
  if (loading) return <p role="status" className="text-xs text-gray-500">Loading negotiation cycle…</p>;
  if (error || !cycle) return <p role="status" className="text-xs text-red-600">Negotiation cycle could not be loaded.</p>;

  const phase = cyclePhase(cycle);
  const stages = ['Discovery', 'Strategy', 'Kickoff', 'A2A', 'Reflect'];
  return (
    <section className="space-y-3" aria-label="Intent cycle inspector">
      <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <div>
            <p className="font-ibm-plex-mono text-[10px] uppercase tracking-[0.12em] text-slate-500">PersonalAgent cycle</p>
            <p className="mt-1 text-sm font-semibold text-slate-900">{phase.label}</p>
          </div>
          <p className="font-ibm-plex-mono text-[11px] text-slate-600">{phase.detail}</p>
        </div>
        <ol className="mt-3 grid grid-cols-5 gap-1" aria-label="Cycle stages">
          {stages.map((stage, index) => (
            <li key={stage} className="min-w-0">
              <div className={`h-1 rounded-full ${index + 1 <= phase.active ? 'bg-slate-800' : 'bg-slate-200'}`} />
              <p className={`mt-1 truncate font-ibm-plex-mono text-[9px] ${index + 1 === phase.active ? 'text-slate-900' : 'text-slate-400'}`}>{stage}</p>
            </li>
          ))}
        </ol>
        <p className="mt-3 font-ibm-plex-mono text-[10px] text-slate-500">
          round {cycle.round.number} · {cycle.round.size === null ? 'opening not yet stamped' : `${cycle.round.size} opened`}
        </p>
      </div>

      {cycle.negotiations.length === 0 ? (
        <p className="rounded-lg border border-dashed border-gray-200 px-3 py-4 text-center text-xs text-gray-500">No negotiations have been opened for this intent.</p>
      ) : (
        <ol className="space-y-2" aria-label="Negotiations for this intent">
          {cycle.negotiations.map((negotiation) => (
            <li key={negotiation.taskId} className="rounded-lg border border-gray-200 bg-white p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="min-w-0">
                  <p className="truncate text-xs font-semibold text-gray-900">{negotiation.counterpartLabel}</p>
                  <p className="font-ibm-plex-mono text-[10px] text-gray-500">round {negotiation.round} · {negotiation.state} · {negotiation.opportunityStatus}</p>
                  <p className="mt-0.5 font-ibm-plex-mono text-[9px] text-gray-400" title={`task ${negotiation.taskId} · opportunity ${negotiation.opportunityId}`}>
                    task {negotiation.taskId.slice(0, 8)} · opportunity {negotiation.opportunityId.slice(0, 8)}
                  </p>
                </div>
                <Link to={`/i/${intentId}/negotiations/${negotiation.taskId}`} className="text-[11px] font-medium text-[#35799C] hover:underline">Inspect</Link>
              </div>
              <p className="mt-2 text-xs leading-relaxed text-gray-700">{activityLabel(negotiation)}</p>
              {negotiation.pause && <p className="mt-1 font-ibm-plex-mono text-[10px] text-amber-700">pause · {pauseLabel(negotiation.pause.reason, negotiation.pause.by)}</p>}
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
