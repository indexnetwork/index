import { useEffect, useState } from 'react';
import { Brain, ChevronDown, ChevronRight } from 'lucide-react';
import { Link } from 'react-router';

import { useAuthenticatedAPI } from '@/lib/api';
import { negotiatorMemoriesPath, type NegotiatorMemoriesResponse, type NegotiatorMemory, type NegotiatorMemoryKind } from '@/services/negotiatorMemories';

/**
 * "What your agent has learned here" — the intent-scoped slice of the
 * negotiator's memory (memories whose source negotiations ran for this
 * intent). Renders nothing while loading, on error, or when the intent has
 * produced no memories yet: the strip is evidence, not chrome.
 *
 * Full inspection/editing lives at /agent/memory (P5.4); this is a read-only
 * window with a link there.
 */

const KIND_LABELS: Record<NegotiatorMemoryKind, string> = {
  disclosure_rule: 'Disclosure rule',
  threshold: 'Threshold',
  playbook: 'Playbook',
  counterparty_dossier: 'Counterparty note',
};

const MAX_ROWS = 5;

export default function IntentMemoryStrip({
  intentId,
  userId,
}: {
  intentId: string;
  userId: string;
}) {
  const api = useAuthenticatedAPI();
  const [memories, setMemories] = useState<NegotiatorMemory[]>([]);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    if (!userId || !intentId) return;
    let cancelled = false;
    api
      .get<NegotiatorMemoriesResponse>(negotiatorMemoriesPath(userId, { intentId }))
      .then((res) => {
        if (!cancelled) setMemories(res.memories);
      })
      .catch(() => {
        /* best-effort — the strip simply stays hidden */
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId, intentId]);

  if (memories.length === 0) return null;

  return (
    <div
      data-testid="intent-memory-strip"
      className="mb-3 shrink-0 rounded-lg border border-gray-100 bg-gray-50/60 px-3 py-2"
    >
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
        className="flex w-full items-center gap-1.5 text-left text-xs font-medium text-gray-600 hover:text-gray-900"
      >
        {expanded ? (
          <ChevronDown className="h-3.5 w-3.5 shrink-0 text-gray-400" />
        ) : (
          <ChevronRight className="h-3.5 w-3.5 shrink-0 text-gray-400" />
        )}
        <Brain className="h-3.5 w-3.5 shrink-0 text-gray-400" />
        <span>
          What your agent has learned here ({memories.length})
        </span>
      </button>

      {expanded && (
        <div className="mt-2 space-y-1.5 pl-5">
          {memories.slice(0, MAX_ROWS).map((m) => (
            <div key={m.id} className="flex items-start gap-2 text-xs text-gray-700">
              <span className="mt-px shrink-0 rounded bg-gray-100 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-gray-500">
                {KIND_LABELS[m.kind]}
              </span>
              <p className="line-clamp-2 leading-relaxed">{m.content}</p>
            </div>
          ))}
          <Link
            to="/agent/memory"
            className="inline-block pt-0.5 text-[11px] font-medium text-gray-500 underline-offset-2 hover:text-gray-900 hover:underline"
          >
            Review or edit in Memory →
          </Link>
        </div>
      )}
    </div>
  );
}
