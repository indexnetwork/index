import type { NegotiationDetail } from "@/services/negotiations";
import { cn } from "@/lib/utils";

/**
 * Render shared history without treating earlier sessions as current offers.
 * @param props - The explicitly selected session and the viewing principal.
 * @returns Ordered historical sections followed by the selected session.
 */
export default function NegotiationTranscript({ record, viewerUserId }: {
  record: NegotiationDetail; viewerUserId?: string;
}) {
  const sessions = [...record.previousSessions, record];
  return <>
    {record.previousSessions.length > 0 && <p className="text-xs text-gray-500">
      Earlier sessions are history, not offers in this session.
    </p>}
    {sessions.map((session) => <section key={session.id} className="space-y-3" data-session-id={session.id}>
      <h4 className="border-b border-gray-200 py-2 text-xs font-medium text-gray-600">
        Session {session.sessionNumber} · {session.outcome === "agreed" ? "Agents agreed" : session.outcome ?? "In progress"}
        {" · Opportunity: "}{session.opportunityStatus}
      </h4>
      {session.turns.length === 0 ? <p className="py-4 text-sm text-gray-500">
        {session.id === record.id && !session.outcome ? "Waiting for the opening proposal." : "No turns recorded."}
      </p> : session.turns.map((turn) => {
        const own = turn.seatUserId === viewerUserId;
        return <article key={turn.turnIndex} className={cn("rounded-xl border p-3", own ? "border-blue-100 bg-blue-50/60" : "border-gray-200 bg-gray-50")}>
          <p className="mb-2 flex flex-wrap items-center gap-2 text-xs text-gray-500">
            <span className="font-semibold text-gray-800">{own ? "Your agent" : `${record.counterparty.name ?? "Their"}'s agent`}</span>
            <span className="capitalize">{turn.action}</span>
          </p>
          <p className="whitespace-pre-wrap break-words text-sm leading-relaxed text-gray-800">{turn.message}</p>
        </article>;
      })}
    </section>)}
  </>;
}
