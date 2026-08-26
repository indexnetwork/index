import { Link } from "react-router";

import UserAvatar from "@/components/UserAvatar";
import type { IntentCycleSnapshot } from "@/services/conversation";
import type { RadarCardItem } from "@/services/opportunities";

type Negotiation = IntentCycleSnapshot["negotiations"][number] | undefined;

function waitingCopy(negotiation: Negotiation): string {
  switch (negotiation?.pause?.reason) {
    case "needs_principal": return "Waiting for their principal’s guidance.";
    case "ready_for_verdict": return "Waiting for their agent’s decision.";
    case "counterparty_silent": return "Waiting for the other side to respond.";
    case "turn_cap": return "Waiting for their agent to continue.";
    default: return "Waiting for the other side.";
  }
}

function activityCopy(negotiation: Negotiation, waiting: boolean): { label: string; text: string } {
  if (waiting) return { label: "Waiting", text: waitingCopy(negotiation) };
  const activity = negotiation?.latestActivity;
  if (!activity) return { label: "Personal Agent", text: "Preparing negotiation." };
  const label = activity.actor === "yours" ? "My Agent" : "Their Agent";
  if (activity.verb === "pause") return { label, text: "Paused this negotiation." };
  if (activity.text) return { label, text: activity.text };
  return { label, text: `${activity.verb ? activity.verb.replace(/_/g, " ") : "Acted"}.` };
}

/**
 * Radar's agent-owned rows intentionally use only durable identity and A2A
 * state. Presenter prose belongs on human decision cards, never here.
 */
export default function AgentHandlingOpportunity({
  item,
  negotiation,
  waiting = false,
  inspectorHref,
}: {
  item: RadarCardItem;
  negotiation: Negotiation;
  waiting?: boolean;
  inspectorHref?: string;
}) {
  const activity = activityCopy(negotiation, waiting);
  return (
    <article data-testid={`agent-handling-${item.opportunityId}`} className="rounded-lg border border-gray-200 bg-white p-4">
      <div className="flex items-start gap-3">
        <UserAvatar id={item.userId} name={item.name} avatar={item.avatar} size={40} />
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-3">
            <p className="truncate text-sm font-semibold text-gray-900">{item.name}</p>
            {inspectorHref && <Link to={inspectorHref} className="shrink-0 text-xs font-medium text-[#35799C] hover:underline">Inspect</Link>}
          </div>
          <p className="mt-2 font-ibm-plex-mono text-[10px] uppercase tracking-[0.12em] text-slate-500">{activity.label}</p>
          <p className="mt-1 text-sm leading-relaxed text-gray-700">{activity.text}</p>
        </div>
      </div>
    </article>
  );
}
