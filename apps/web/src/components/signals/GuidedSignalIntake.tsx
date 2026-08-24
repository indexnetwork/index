import { useState } from "react";
import { Check, Loader2, Send } from "lucide-react";

import type { AnswerBody, QuestionPayload } from "@/services/questions";

export type GuidedProposal = {
  proposalId: string;
  description: string;
  networkId?: string;
  lookingFor?: string;
  youBring?: string;
  offering?: string;
  networks?: Array<{ id?: string; title?: string }>;
};

export interface GuidedSignalConfirmation {
  intentId: string;
  proposal: GuidedProposal | null;
  networkId?: string;
  networkTitle: string;
}

export function GuidedQuestion({
  question,
  onAnswer,
  disabled,
}: {
  question: { id: string; payload: QuestionPayload };
  onAnswer: (body: AnswerBody) => Promise<void>;
  disabled: boolean;
}) {
  const [selected, setSelected] = useState<string[]>([]);
  const [freeText, setFreeText] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const canSubmit = selected.length > 0 || freeText.trim().length > 0;

  const toggleOption = (label: string) => {
    setSelected((current) => {
      if (question.payload.multiSelect) {
        return current.includes(label) ? current.filter((item) => item !== label) : [...current, label];
      }
      return [label];
    });
    setFreeText("");
  };

  const submit = async () => {
    if (!canSubmit || submitting || disabled) return;
    setSubmitting(true);
    try {
      await onAnswer({
        selectedOptions: selected,
        ...(freeText.trim() ? { freeText: freeText.trim() } : {}),
      });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <section aria-label="Current question" className="mt-8">
      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-gray-400">Next</p>
      <h1 className="mt-3 text-2xl font-semibold leading-tight text-[#041729] sm:text-3xl">
        {question.payload.prompt}
      </h1>
      {question.payload.multiSelect && <p className="mt-2 text-sm text-gray-500">Choose all that apply.</p>}
      <div className="mt-6 grid gap-3">
        {question.payload.options.map((option) => {
          const checked = selected.includes(option.label);
          return (
            <button
              key={option.label}
              type="button"
              disabled={disabled || submitting}
              aria-pressed={checked}
              onClick={() => toggleOption(option.label)}
              className={`rounded-2xl border px-4 py-3 text-left transition ${
                checked
                  ? "border-[#041729] bg-[#041729] text-white"
                  : "border-gray-200 bg-white text-gray-800 hover:border-gray-400"
              } disabled:cursor-not-allowed disabled:opacity-60`}
            >
              <span className="block text-sm font-medium">{option.label}</span>
              {option.description && (
                <span className={`mt-1 block text-xs ${checked ? "text-gray-200" : "text-gray-500"}`}>
                  {option.description}
                </span>
              )}
            </button>
          );
        })}
      </div>
      <textarea
        value={freeText}
        onChange={(event) => {
          setFreeText(event.target.value);
          if (event.target.value.trim()) setSelected([]);
        }}
        disabled={disabled || submitting}
        placeholder="Or tell me in your own words"
        rows={2}
        className="mt-4 w-full resize-none rounded-2xl border border-gray-200 bg-white px-4 py-3 text-sm text-gray-800 outline-none transition placeholder:text-gray-400 focus:border-[#041729] focus:ring-2 focus:ring-[#041729]/10 disabled:opacity-60"
      />
      <button
        type="button"
        onClick={() => void submit()}
        disabled={!canSubmit || disabled || submitting}
        className="mt-4 inline-flex items-center gap-2 rounded-full bg-[#041729] px-5 py-2.5 text-sm font-medium text-white transition hover:bg-[#0a2d4a] disabled:cursor-not-allowed disabled:opacity-40"
      >
        {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
        Continue
      </button>
    </section>
  );
}

export function ProposalCard({
  proposal,
  networkTitle,
  lookingFor,
  youBring,
  onConfirm,
  onFeedback,
  onSkip,
  busy,
  error,
}: {
  proposal: GuidedProposal;
  networkTitle: string;
  lookingFor?: string;
  youBring?: string;
  onConfirm: (description: string) => Promise<void>;
  onFeedback: (feedback: string) => Promise<void>;
  onSkip: () => Promise<void>;
  busy: boolean;
  error: string | null;
}) {
  const [description, setDescription] = useState(proposal.description);
  const [feedback, setFeedback] = useState("");
  const [sendingFeedback, setSendingFeedback] = useState(false);
  const [skipping, setSkipping] = useState(false);
  const [feedbackError, setFeedbackError] = useState<string | null>(null);
  const resolvedLookingFor = lookingFor ?? proposal.lookingFor ?? proposal.description;
  const resolvedYouBring = youBring ?? proposal.youBring ?? proposal.offering;

  const submitFeedback = async () => {
    const trimmedFeedback = feedback.trim();
    if (!trimmedFeedback || busy || sendingFeedback || skipping) return;
    setSendingFeedback(true);
    setFeedbackError(null);
    try {
      await onFeedback(trimmedFeedback);
    } catch {
      setFeedbackError("Couldn't send your feedback. Please try again.");
    } finally {
      setSendingFeedback(false);
    }
  };

  return (
    <section aria-label="Confirm signal" className="mt-10 rounded-3xl border border-gray-200 bg-white p-6 shadow-sm sm:p-8">
      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-gray-400">One last look</p>
      <h1 className="mt-3 text-2xl font-semibold text-[#041729]">Does this feel right?</h1>
      <div className="mt-7 space-y-5">
        <div>
          <label htmlFor="signal-description" className="text-[10px] font-semibold tracking-[0.18em] text-gray-400">YOUR SIGNAL</label>
          <textarea
            id="signal-description"
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            disabled={busy || sendingFeedback || skipping}
            rows={4}
            className="mt-2 w-full resize-y rounded-2xl border border-gray-200 bg-white px-4 py-3 text-base leading-relaxed text-gray-800 outline-none transition focus:border-[#041729] focus:ring-2 focus:ring-[#041729]/10 disabled:opacity-60"
          />
          <p className="mt-2 text-xs text-gray-500">This is exactly what will be shared after you confirm. Edit it directly, or ask your agent to revise it.</p>
        </div>
        <Summary label="LOOKING FOR" value={resolvedLookingFor} />
        <Summary label="YOU BRING" value={resolvedYouBring ?? "Not specified"} />
        <Summary label="NETWORKS" value={networkTitle} />
      </div>
      {error && <p role="alert" className="mt-5 rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
      {feedbackError && <p role="alert" className="mt-5 rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700">{feedbackError}</p>}
      <div className="mt-6">
        <label htmlFor="signal-feedback" className="text-sm font-medium text-[#041729]">Want your agent to revise it?</label>
        <div className="mt-2 flex flex-col gap-3 sm:flex-row">
          <input
            id="signal-feedback"
            value={feedback}
            onChange={(event) => setFeedback(event.target.value)}
            disabled={busy || sendingFeedback || skipping}
            placeholder="Tell it what to change"
            className="min-w-0 flex-1 rounded-full border border-gray-200 px-4 py-2.5 text-sm text-gray-800 outline-none transition placeholder:text-gray-400 focus:border-[#041729] focus:ring-2 focus:ring-[#041729]/10 disabled:opacity-60"
          />
          <button
            type="button"
            disabled={!feedback.trim() || busy || sendingFeedback || skipping}
            onClick={() => void submitFeedback()}
            className="rounded-full border border-[#041729] px-4 py-2.5 text-sm font-medium text-[#041729] hover:bg-[#041729] hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
          >
            {sendingFeedback ? "Sending…" : "Revise with agent"}
          </button>
        </div>
      </div>
      <div className="mt-7 flex flex-wrap items-center gap-3">
        <button
          type="button"
          disabled={!description.trim() || busy || sendingFeedback || skipping}
          onClick={() => void onConfirm(description.trim())}
          className="inline-flex items-center gap-2 rounded-full bg-[#041729] px-5 py-2.5 text-sm font-medium text-white hover:bg-[#0a2d4a] disabled:opacity-50"
        >
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
          Confirm signal
        </button>
        <button
          type="button"
          disabled={busy || skipping}
          onClick={async () => {
            setSkipping(true);
            try {
              await onSkip();
            } finally {
              setSkipping(false);
            }
          }}
          className="rounded-full px-4 py-2.5 text-sm text-gray-500 hover:bg-gray-100 disabled:opacity-50"
        >
          {skipping ? "Skipping…" : "Not yet"}
        </button>
      </div>
    </section>
  );
}

function Summary({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[10px] font-semibold tracking-[0.18em] text-gray-400">{label}</p>
      <p className="mt-1 text-base leading-relaxed text-gray-800">{value}</p>
    </div>
  );
}

