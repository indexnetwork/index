export interface AnsweredThreadEntry {
  id: string;
  prompt: string;
  response: string;
  /** Authoritative assistant message anchor, when the question came from chat. */
  messageId?: string;
  /** Authoritative question creation timestamp used only when no message anchor is available. */
  createdAt?: string;
  /** Authoritative detection timestamp used only when no message anchor is available. */
  detectedAt?: string;
  /** Authoritative answer timestamp returned by the server after hydration. */
  answeredAt?: string;
}

/** Compact relative time for the answered thread, e.g. "just now", "2d ago". */
function timeAgo(iso?: string): string {
  if (!iso) return "";
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "";
  const secs = Math.max(0, Math.floor((Date.now() - then) / 1000));
  if (secs < 60) return "just now";
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

/** Renders the user's answered question exchanges in the intent conversation. */
export function AnsweredQuestionLog({ entries }: { entries: AnsweredThreadEntry[] }) {
  return (
    <div className="flex flex-col gap-3">
      {entries.map((entry) => (
        <div key={entry.id} className="px-1">
          {entry.prompt && (
            <p className="text-[13px] text-gray-400">
              {entry.prompt}
              {entry.answeredAt && (
                <span className="text-gray-300">
                  {" · "}
                  {timeAgo(entry.answeredAt)}
                </span>
              )}
            </p>
          )}
          <p className="mt-0.5 flex gap-1.5 text-[13px] text-gray-900 font-ibm-plex-mono">
            <span className="text-gray-400">›</span>
            <span>{entry.response}</span>
          </p>
          <p className="mt-1 text-[12px] text-gray-400">
            noted — updating the search.
          </p>
        </div>
      ))}
    </div>
  );
}
