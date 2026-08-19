import type { NegotiationActivityGroup, NegotiationActivityMessage, NegotiationChecklistItem } from "@/services/conversation";
import { verbFor } from "@/components/negotiations/negotiation-turns";

function messageText(message: NegotiationActivityMessage): string {
  if (typeof message.text === "string" && message.text.trim().length > 0) return message.text.trim();
  // Pre-projection payload: the text lived in the parts.
  return message.parts
    .map((part) => {
      if (typeof part === "string") return part;
      if (!part || typeof part !== "object") return "";
      const value = part as Record<string, unknown>;
      return typeof value.text === "string" ? value.text : "";
    })
    .filter(Boolean)
    .join("\n")
    .trim();
}

/**
 * The checklist is the negotiation's reasoning made visible: `unknown` is the
 * live one — it is what the agent may still come back and ask about — so it
 * reads as attention rather than as a neutral third state.
 */
const RESULT_STYLE: Record<string, { chip: string; label: string }> = {
  ok: { chip: "border-emerald-200 bg-emerald-50 text-emerald-700", label: "ok" },
  conflict: { chip: "border-red-200 bg-red-50 text-red-700", label: "conflict" },
  unknown: { chip: "border-amber-200 bg-amber-50 text-amber-700", label: "open" },
};

function ChecklistStrip({ items }: { items: NegotiationChecklistItem[] }) {
  const open = items.filter((item) => item.result === "unknown").length;
  const conflicts = items.filter((item) => item.result === "conflict").length;
  return (
    <div className="mb-2" aria-label="Match checklist">
      <p className="mb-1 text-[10px] font-ibm-plex-mono uppercase tracking-[0.12em] text-gray-400">
        Checklist · {items.length} {items.length === 1 ? "dimension" : "dimensions"}
        {conflicts > 0 ? ` · ${conflicts} conflicting` : ""}
        {open > 0 ? ` · ${open} open` : ""}
      </p>
      <ul className="flex flex-wrap gap-1">
        {items.map((item) => {
          const style = RESULT_STYLE[item.result] ?? RESULT_STYLE.unknown;
          return (
            <li
              key={item.name}
              // The basis is the audit trail: what the agent read to score it.
              title={item.basis || "Nothing on the record settles this yet."}
              className={`rounded border px-1.5 py-0.5 text-[11px] ${style.chip}`}
            >
              <span className="font-medium">{item.name}</span>
              <span className="ml-1 opacity-70">{style.label}</span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

export default function NegotiationActivity({
  groups,
  loading,
  error,
}: {
  groups: NegotiationActivityGroup[];
  loading: boolean;
  error: boolean;
}) {
  if (loading) {
    return <p role="status" className="text-xs text-gray-500">Loading agent messages…</p>;
  }
  if (error) {
    return <p role="status" className="text-xs text-red-600">Agent messages could not be loaded. Radar will retry automatically.</p>;
  }
  if (groups.length === 0) {
    return <p className="text-xs text-gray-500">No agent conversations have started yet.</p>;
  }

  return (
    <div className="space-y-3" aria-live="polite" aria-label="Live agent negotiation messages">
      {groups.map((group) => (
        <section
          key={group.correspondentUserId}
          aria-label={`Negotiation with ${group.correspondentLabel}`}
          className="rounded-lg border border-gray-200 bg-gray-50/60 p-3"
        >
          <h4 className="mb-2 text-xs font-semibold text-gray-700">{group.correspondentLabel}</h4>
          {group.checklist && group.checklist.length > 0 && <ChecklistStrip items={group.checklist} />}
          <ol className="space-y-2">
            {group.messages.map((message) => {
              const text = messageText(message);
              if (!text) return null;
              const yours = message.sender === "yours";
              const verb = verbFor(message.action ?? null);
              return (
                <li key={message.id} className="text-xs">
                  <span className="font-semibold text-gray-600">
                    {yours ? "Your agent" : "Their agent"}
                  </span>
                  {verb && (
                    <span className={`ml-1.5 text-[10px] font-ibm-plex-mono uppercase tracking-[0.12em] ${verb.color}`}>
                      {verb.label}
                    </span>
                  )}
                  <p className="mt-0.5 whitespace-pre-wrap text-gray-800">{text}</p>
                </li>
              );
            })}
          </ol>
        </section>
      ))}
    </div>
  );
}
