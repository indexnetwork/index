import type { NegotiationActivityGroup } from "@/services/conversation";

function messageText(parts: unknown[]): string {
  return parts
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
    return <p className="text-xs text-gray-500">Your agent is still talking with theirs. Messages will appear here as they are persisted.</p>;
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
          <ol className="space-y-2">
            {group.messages.map((message) => {
              const text = messageText(message.parts);
              if (!text) return null;
              const yours = message.sender === "yours";
              return (
                <li key={message.id} className="text-xs">
                  <span className="font-semibold text-gray-600">
                    {yours ? "Your agent" : "Their agent"}
                  </span>
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
