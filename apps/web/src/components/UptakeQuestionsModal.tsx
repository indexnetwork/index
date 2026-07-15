import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Loader2, X } from "lucide-react";

import { QuestionCard } from "@/components/DecisionQuestions/QuestionCard";
import type { Answer } from "@/components/DecisionQuestions/flatten";
import type { UptakeAcceptanceAdvisory } from "@/services/opportunities";
import type { AnswerBody } from "@/services/questions";

interface UptakeQuestionsModalProps {
  advisory: UptakeAcceptanceAdvisory;
  onAnswer: (questionId: string, body: AnswerBody) => Promise<void>;
  onDismiss: (questionId: string) => Promise<void>;
  onContinue: (questionIds: string[]) => Promise<void>;
  onCancel: () => void;
}

/** Accessible soft-interlock modal for unresolved opportunity uptake questions. */
export default function UptakeQuestionsModal({
  advisory,
  onAnswer,
  onDismiss,
  onContinue,
  onCancel,
}: UptakeQuestionsModalProps) {
  const titleRef = useRef<HTMLHeadingElement>(null);
  const [answers, setAnswers] = useState<Record<string, Answer>>({});
  const [resolvedIds, setResolvedIds] = useState<Set<string>>(new Set());
  const [submittingId, setSubmittingId] = useState<string | null>(null);
  const [continuing, setContinuing] = useState(false);
  const [retrying, setRetrying] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    titleRef.current?.focus();
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !continuing && !retrying && !submittingId) onCancel();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [continuing, onCancel, retrying, submittingId]);

  const allIds = useMemo(() => advisory.questions.map((question) => question.id), [advisory]);

  const resolveQuestion = async (questionId: string, action: "answer" | "dismiss") => {
    setError(null);
    setSubmittingId(questionId);
    try {
      if (action === "dismiss") {
        await onDismiss(questionId);
      } else {
        const answer = answers[questionId];
        if (!answer) throw new Error("Choose an answer first.");
        const body: AnswerBody = answer.kind === "other"
          ? { selectedOptions: [], freeText: answer.text.trim() }
          : { selectedOptions: answer.selectedLabels };
        if (!body.freeText && body.selectedOptions.length === 0) throw new Error("Choose an answer first.");
        await onAnswer(questionId, body);
      }
      setResolvedIds((current) => new Set(current).add(questionId));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not update the question.");
    } finally {
      setSubmittingId(null);
    }
  };

  return createPortal(
    <div
      className="fixed inset-0 z-[210] flex items-center justify-center bg-black/45 p-4"
      role="presentation"
      onMouseDown={(event) => { if (event.target === event.currentTarget && !continuing) onCancel(); }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="uptake-dialog-title"
        aria-describedby="uptake-dialog-description"
        className="flex max-h-[90vh] w-full max-w-2xl flex-col overflow-hidden rounded-lg bg-white shadow-xl"
      >
        <div className="flex items-start justify-between gap-4 border-b border-gray-100 p-5">
          <div>
            <h2
              id="uptake-dialog-title"
              ref={titleRef}
              tabIndex={-1}
              className="font-ibm-plex-mono text-base font-bold text-gray-900 outline-none"
            >
              Questions before connecting
            </h2>
            <p id="uptake-dialog-description" className="mt-1 text-sm text-gray-500">
              Answer or dismiss these questions, then retry. You can also continue anyway.
            </p>
          </div>
          <button type="button" aria-label="Cancel acceptance" onClick={onCancel} disabled={continuing} className="text-gray-400 hover:text-gray-700 disabled:opacity-50">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex flex-col gap-4 overflow-y-auto p-5">
          {advisory.questions.map((question) => {
            const resolved = resolvedIds.has(question.id);
            const submitting = submittingId === question.id;
            return (
              <div key={question.id} className={resolved ? "opacity-55" : ""}>
                <QuestionCard
                  questionId={`uptake-${question.id}`}
                  question={question}
                  answer={answers[question.id] ?? null}
                  disabled={resolved || submitting || continuing}
                  onAnswerChange={(answer) => setAnswers((current) => ({ ...current, [question.id]: answer }))}
                />
                <div className="mt-2 flex justify-end gap-2">
                  <button type="button" disabled={resolved || submitting || continuing} onClick={() => void resolveQuestion(question.id, "dismiss")} className="rounded-sm border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50">
                    {resolved ? "Resolved" : "Dismiss"}
                  </button>
                  <button type="button" disabled={resolved || submitting || continuing} onClick={() => void resolveQuestion(question.id, "answer")} className="rounded-sm bg-[#041729] px-3 py-1.5 text-xs font-medium text-white hover:bg-[#0a2d4a] disabled:opacity-50">
                    {submitting ? "Saving…" : resolved ? "Saved" : "Submit answer"}
                  </button>
                </div>
              </div>
            );
          })}
          {error ? <p role="alert" className="text-sm text-red-600">{error}</p> : null}
        </div>

        <div className="flex flex-wrap justify-end gap-2 border-t border-gray-100 p-5">
          <button type="button" onClick={onCancel} disabled={continuing || retrying || !!submittingId} className="rounded-sm border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50">
            Cancel
          </button>
          {resolvedIds.size === allIds.length && allIds.length > 0 ? (
            <button
              type="button"
              disabled={continuing || retrying || !!submittingId}
              onClick={() => {
                setRetrying(true);
                setError(null);
                void onContinue([]).catch((cause) => {
                  setError(cause instanceof Error ? cause.message : "Could not retry acceptance.");
                  setRetrying(false);
                });
              }}
              className="flex items-center gap-2 rounded-sm border border-[#041729] px-4 py-2 text-sm font-medium text-[#041729] hover:bg-gray-50 disabled:opacity-50"
            >
              {retrying ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              Accept now
            </button>
          ) : null}
          <button
            type="button"
            disabled={continuing || retrying || !!submittingId}
            onClick={() => {
              setContinuing(true);
              setError(null);
              void onContinue(allIds).catch((cause) => {
                setError(cause instanceof Error ? cause.message : "Could not continue.");
                setContinuing(false);
              });
            }}
            className="flex items-center gap-2 rounded-sm bg-[#041729] px-4 py-2 text-sm font-medium text-white hover:bg-[#0a2d4a] disabled:opacity-50"
          >
            {continuing ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            Continue anyway
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
