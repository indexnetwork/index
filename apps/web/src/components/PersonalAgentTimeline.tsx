import type { IntentCycleTimelineEntry } from "@/services/conversation";

function json(value: Record<string, unknown>): string {
  return JSON.stringify(value, null, 2);
}

function toolResult(act: Record<string, unknown>): { tool: string; result: string; detail: string | null } {
  const tool = typeof act.tool === "string" ? act.tool : "unknown act";
  switch (tool) {
    case "message_user":
      return { tool, result: "Delivered", detail: typeof act.text === "string" ? act.text : null };
    case "kickoff": {
      const opened = typeof act.opened === "number" ? act.opened : null;
      const failed = typeof act.failed === "number" ? act.failed : null;
      const counts = [
        typeof act.batchId === "string" ? `batch ${act.batchId.slice(0, 8)}` : null,
        typeof act.attempted === "number" ? `${act.attempted} attempted` : null,
        opened !== null ? `${opened} opened` : null,
        failed !== null ? `${failed} failed` : null,
      ].filter((part): part is string => part !== null);
      const result = failed && opened === 0 ? "Failed" : failed ? "Partial" : "Completed";
      return { tool, result, detail: counts.join(" · ") || null };
    }
    case "promote":
    case "reject":
      return {
        tool,
        result: act.outcome === "error" ? "Failed" : act.outcome === "resolved" ? "Resolved" : "Executed",
        detail: [
          typeof act.negotiationId === "string" ? `negotiation ${act.negotiationId}` : null,
          typeof act.opportunityId === "string" && act.opportunityId ? `opportunity ${act.opportunityId}` : null,
          typeof act.reasoning === "string" ? act.reasoning : null,
        ].filter((part): part is string => part !== null).join(" · ") || null,
      };
    case "note_dossier":
      return {
        tool,
        result: typeof act.entryId === "string" ? "Saved" : "Completed",
        detail: typeof act.text === "string" ? act.text : null,
      };
    case "retire_dossier":
      return {
        tool,
        result: act.retired === false ? "Not retired" : act.retired === true ? "Retired" : "Completed",
        detail: typeof act.entryId === "string" ? `dossier entry ${act.entryId}` : null,
      };
    case "accept_opportunity":
      return {
        tool,
        result: typeof act.outcome === "string" ? act.outcome : "Executed",
        detail: [
          typeof act.opportunityId === "string" ? `opportunity ${act.opportunityId}` : null,
          typeof act.counterparty === "string" ? act.counterparty : null,
          typeof act.reason === "string" ? act.reason : null,
        ].filter((part): part is string => part !== null).join(" · ") || null,
      };
    default:
      return { tool, result: "Executed", detail: null };
  }
}

function PersonalAgentActRow({ entry }: { entry: IntentCycleTimelineEntry }) {
  const { tool, result, detail } = toolResult(entry.act);
  const event = typeof entry.event.kind === "string" ? entry.event.kind : "unknown event";
  return (
    <li className="border-l-2 border-slate-200 pl-3">
      <p className="font-ibm-plex-mono text-[10px] uppercase tracking-[0.12em] text-slate-600">
        {event} → {tool} · {result}
      </p>
      {detail && <p className="mt-1 whitespace-pre-wrap text-xs text-gray-700">{detail}</p>}
      <time className="mt-1 block font-ibm-plex-mono text-[10px] text-gray-400">{new Date(entry.createdAt).toLocaleString()} · {entry.id}</time>
      <details className="mt-2">
        <summary className="cursor-pointer text-[11px] text-[#35799C]">Raw event and executed act</summary>
        <div className="mt-2 grid gap-2 lg:grid-cols-2">
          <pre className="overflow-x-auto rounded bg-white p-2 font-ibm-plex-mono text-[10px] text-slate-700">{json(entry.event)}</pre>
          <pre className="overflow-x-auto rounded bg-white p-2 font-ibm-plex-mono text-[10px] text-slate-700">{json(entry.act)}</pre>
        </div>
      </details>
    </li>
  );
}

export function PersonalAgentDebugTrace({
  entries,
}: {
  entries: IntentCycleTimelineEntry[];
}) {
  return (
    <section className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2" data-testid="personal-agent-debug-trace">
      <p className="font-ibm-plex-mono text-[10px] uppercase tracking-[0.12em] text-slate-600">
        PersonalAgent debug trace
      </p>
      <ol className="mt-3 space-y-3">{entries.map((entry) => <PersonalAgentActRow key={entry.id} entry={entry} />)}</ol>
    </section>
  );
}
