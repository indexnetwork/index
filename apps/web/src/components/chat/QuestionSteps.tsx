import { CornerDownRight } from "lucide-react";
import type { QuestionBlock } from "@indexnetwork/protocol/question-block";

export interface QuestionStepsProps {
  block: QuestionBlock;
  /**
   * Tap-to-quote: prefill the chat input with the question being answered.
   * Answering stays a plain chat reply — this is a convenience, not a submit path.
   */
  onQuote?: (prompt: string) => void;
}

/**
 * Steps UI for a parsed question-message
 * (docs/plans/2026-08-18-conversational-questions.md).
 *
 * One step per question: an ordinal and the agent-authored prompt. The block's
 * negotiation refs (opportunityId / alsoUnblocks) are answer-routing data for
 * the server and are deliberately never displayed. There is no form and no
 * submit path — the user answers by typing in the conversation's input.
 */
export function QuestionSteps({ block, onQuote }: QuestionStepsProps) {
  return (
    <ol className="my-3 flex flex-col gap-2" data-testid="question-steps">
      {block.questions.map((question, index) => (
        <li
          key={question.opportunityId}
          className="flex items-start gap-3 rounded-lg border border-gray-200 bg-[#FCFCFC] px-3 py-2.5"
          data-testid="question-step"
        >
          <span
            aria-hidden="true"
            className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[#041729] text-[10px] font-medium text-white font-ibm-plex-mono"
          >
            {index + 1}
          </span>
          <span className="min-w-0 flex-1 text-sm text-gray-900">
            {question.prompt}
            {question.options && question.options.length > 0 && (
              // The agent's own decision options, each stating what it would do
              // next if chosen. Tapping one quotes it into the input rather
              // than submitting: answering stays a plain chat reply, which is
              // what keeps the free-text path and these in one lane.
              <span className="mt-2 flex flex-wrap gap-1.5" data-testid="question-step-options">
                {question.options.map((option) => (
                  <button
                    key={option.label}
                    type="button"
                    disabled={!onQuote}
                    onClick={() => onQuote?.(option.label)}
                    title={option.description}
                    className="rounded-full border border-gray-300 bg-white px-2.5 py-1 text-xs text-gray-800 transition-colors hover:border-gray-400 hover:bg-gray-50 disabled:cursor-default disabled:opacity-70"
                  >
                    {option.label}
                  </button>
                ))}
              </span>
            )}
          </span>
          {onQuote && (
            <button
              type="button"
              onClick={() => onQuote(question.prompt)}
              aria-label={`Answer question ${index + 1}`}
              title="Answer this question"
              className="mt-0.5 shrink-0 rounded-full p-1 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-700"
            >
              <CornerDownRight className="h-3.5 w-3.5" />
            </button>
          )}
        </li>
      ))}
    </ol>
  );
}

/**
 * Agent-working indicator for a pending question-message regeneration: the
 * server is rewriting the conversation's question-message, so what is on
 * screen may be about to be replaced. Shown while the regeneration job for
 * this conversation is queued or running.
 */
export function QuestionRegenerationIndicator() {
  return (
    <div
      data-testid="question-regeneration-indicator"
      aria-label="Your agent is updating its questions"
      className="flex items-center gap-2 px-2 py-2"
    >
      <span className="flex items-center gap-1">
        <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-gray-400" />
        <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-gray-400 [animation-delay:150ms]" />
        <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-gray-400 [animation-delay:300ms]" />
      </span>
      <span className="text-xs text-gray-500 font-ibm-plex-mono">updating questions…</span>
    </div>
  );
}
