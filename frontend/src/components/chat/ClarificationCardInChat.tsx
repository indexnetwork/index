import { useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { apiClient } from "@/lib/api";

/**
 * One clarification question delivered via the `clarification_request` SSE event.
 *
 * Mirrors `ClarificationQuestion` in backend/src/types/chat-streaming.types.ts —
 * keep the two in sync.
 */
export interface ClarificationQuestionData {
  id: string;
  candidateUserId: string;
  opportunityId?: string;
  networkId?: string;
  /** The counterpart's display name, when known — rendered as a chip on the card. */
  sourceAgentName?: string;
  question: string;
  relevancyScore?: number;
}

interface ClarificationCardInChatProps {
  questions: ClarificationQuestionData[];
  /**
   * Called once after all questions have been resolved (answered or skipped).
   * Sends a follow-up chat message that summarizes what was added so the agent
   * runs a fresh discovery pass with the enriched intent.
   */
  onAllResolved?: (resolved: Array<{ question: string; answer: string }>) => void;
}

/**
 * Paginated card surfaced when an orchestrator-inline negotiation rejects on
 * missing-but-fillable info. Each question is the verbatim ask from a
 * rejecting counterpart agent; answering it updates the source intent so the
 * candidate can be reconsidered.
 *
 * UX: one question at a time with `n / total` indicator, free-text answer,
 * Skip per question. After the last question is resolved (any combination of
 * answer + skip), the card collapses and `onAllResolved` fires.
 */
export default function ClarificationCardInChat({ questions, onAllResolved }: ClarificationCardInChatProps) {
  const [currentIdx, setCurrentIdx] = useState(0);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [resolved, setResolved] = useState<Set<string>>(new Set());
  const [submitting, setSubmitting] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const total = questions.length;
  const current = questions[currentIdx];

  const allResolvedPayload = useMemo(
    () =>
      questions
        .filter((q) => answers[q.id]?.trim())
        .map((q) => ({ question: q.question, answer: answers[q.id]!.trim() })),
    [questions, answers],
  );

  const advanceOrFinish = (nextResolved: Set<string>) => {
    if (nextResolved.size >= total) {
      setCollapsed(true);
      onAllResolved?.(allResolvedPayload);
      return;
    }
    // Find the next unresolved index, wrapping forward.
    for (let offset = 1; offset <= total; offset += 1) {
      const candidate = (currentIdx + offset) % total;
      const q = questions[candidate];
      if (q && !nextResolved.has(q.id)) {
        setCurrentIdx(candidate);
        return;
      }
    }
  };

  const submitAnswer = async () => {
    if (!current) return;
    const answer = answers[current.id]?.trim();
    if (!answer) {
      setError("Add a short answer or skip this question.");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await apiClient.post("/chat/session/clarification/answer", {
        questionId: current.id,
        answer,
      });
      const nextResolved = new Set(resolved);
      nextResolved.add(current.id);
      setResolved(nextResolved);
      advanceOrFinish(nextResolved);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to submit answer.");
    } finally {
      setSubmitting(false);
    }
  };

  const skipAnswer = async () => {
    if (!current) return;
    setSubmitting(true);
    setError(null);
    try {
      await apiClient.post("/chat/session/clarification/answer", {
        questionId: current.id,
        skip: true,
      });
      const nextResolved = new Set(resolved);
      nextResolved.add(current.id);
      setResolved(nextResolved);
      advanceOrFinish(nextResolved);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to skip question.");
    } finally {
      setSubmitting(false);
    }
  };

  const dismissCard = () => {
    setCollapsed(true);
  };

  const goPrev = () => {
    if (total <= 1) return;
    setCurrentIdx((idx) => (idx - 1 + total) % total);
    setError(null);
  };

  const goNext = () => {
    if (total <= 1) return;
    setCurrentIdx((idx) => (idx + 1) % total);
    setError(null);
  };

  if (collapsed || !current) return null;

  const counter = `${currentIdx + 1} of ${total}`;
  const answerValue = answers[current.id] ?? "";
  const isResolved = resolved.has(current.id);

  return (
    <div className="mt-3 rounded-2xl border border-gray-200 bg-[#F8F8F8] p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 text-xs text-gray-500">
            <span className="font-medium text-gray-700">A few more details could unlock new matches</span>
            {current.sourceAgentName && (
              <span className="inline-flex max-w-[12rem] truncate rounded-full bg-white px-2 py-0.5 text-[11px] text-gray-600 ring-1 ring-gray-200">
                {current.sourceAgentName} asked
              </span>
            )}
          </div>
          <p className="mt-2 text-sm font-medium text-gray-900">{current.question}</p>
        </div>
        <button
          type="button"
          aria-label="Dismiss"
          onClick={dismissCard}
          className="rounded-full p-1 text-gray-400 hover:bg-white hover:text-gray-600"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <textarea
        value={answerValue}
        onChange={(e) => setAnswers((a) => ({ ...a, [current.id]: e.target.value }))}
        placeholder="Type your answer…"
        rows={2}
        disabled={submitting || isResolved}
        className={cn(
          "mt-3 w-full resize-none rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm",
          "focus:border-gray-400 focus:outline-none",
          (submitting || isResolved) && "opacity-60",
        )}
      />

      {error && <p className="mt-2 text-xs text-red-600">{error}</p>}

      <div className="mt-3 flex items-center justify-between gap-2">
        <div className="flex items-center gap-1 text-xs text-gray-500">
          {total > 1 && (
            <>
              <button
                type="button"
                aria-label="Previous question"
                onClick={goPrev}
                disabled={submitting}
                className="rounded p-1 hover:bg-white"
              >
                <ChevronLeft className="h-4 w-4" />
              </button>
              <span className="tabular-nums">{counter}</span>
              <button
                type="button"
                aria-label="Next question"
                onClick={goNext}
                disabled={submitting}
                className="rounded p-1 hover:bg-white"
              >
                <ChevronRight className="h-4 w-4" />
              </button>
            </>
          )}
        </div>
        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={skipAnswer}
            disabled={submitting || isResolved}
          >
            Skip
          </Button>
          <Button type="button" size="sm" onClick={submitAnswer} disabled={submitting || isResolved}>
            {submitting ? "Saving…" : "Submit"}
          </Button>
        </div>
      </div>
    </div>
  );
}
