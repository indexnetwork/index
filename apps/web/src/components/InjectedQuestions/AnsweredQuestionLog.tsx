export interface IntentRefinementOutcome {
  /** `pending` = still polling; `applied` = intent description changed; `fallback` = no change detected within bound */
  status: 'pending' | 'applied' | 'fallback';
  /** New phrase / sentence detected in the updated intent description (applied only). */
  snippet?: string;
}

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
  /**
   * Detection mode from QuestionDetection.  When `'intent'` and
   * `intentRefinement` is set, the log renders a live outcome line instead of
   * the generic "noted" text.
   */
  mode?: string;
  /**
   * Live refinement outcome for freshly answered intent-mode questions.
   * Absent for entries hydrated from the server or answered in other modes.
   */
  intentRefinement?: IntentRefinementOutcome;
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

/** Compact inline spinner (pure CSS, no dependency). */
function InlineSpinner() {
  return (
    <span
      aria-hidden="true"
      className="inline-block h-3 w-3 animate-spin rounded-full border border-gray-400 border-t-transparent"
      style={{ verticalAlign: "middle" }}
    />
  );
}

/** Renders the outcome line for a freshly answered intent-mode question. */
function IntentRefinementLine({ outcome }: { outcome: IntentRefinementOutcome }) {
  if (outcome.status === "pending") {
    return (
      <p
        data-testid="intent-refinement-pending"
        className="mt-1 flex items-center gap-1.5 text-[12px] text-gray-400"
      >
        <InlineSpinner />
        <span>folding your answer into the signal…</span>
      </p>
    );
  }

  if (outcome.status === "applied") {
    return (
      <p data-testid="intent-refinement-applied" className="mt-1 text-[12px] text-gray-400">
        <span className="text-gray-500">✓</span>{" "}
        {outcome.snippet
          ? <>signal updated — now includes: <span className="text-gray-600 font-ibm-plex-mono">&ldquo;{outcome.snippet}&rdquo;</span></>
          : "signal updated"
        }
      </p>
    );
  }

  // fallback
  return (
    <p data-testid="intent-refinement-fallback" className="mt-1 text-[12px] text-gray-400">
      answer saved — it will shape future matches
    </p>
  );
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
          {entry.mode === "intent" && entry.intentRefinement ? (
            <IntentRefinementLine outcome={entry.intentRefinement} />
          ) : (
            <p className="mt-1 text-[12px] text-gray-400">
              noted — updating the search.
            </p>
          )}
        </div>
      ))}
    </div>
  );
}
