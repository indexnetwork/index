import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Check, ChevronLeft, Loader2, Send } from "lucide-react";
import { Navigate, useNavigate } from "react-router";

import { useAIChat } from "@/contexts/AIChatContext";
import { useAuthContext } from "@/contexts/AuthContext";
import { useNetworksState } from "@/contexts/IndexesContext";
import { useQuestionsService } from "@/contexts/APIContext";
import { useNotifications } from "@/contexts/NotificationContext";
import type { AnswerBody, PendingQuestion } from "@/services/questions";
import { apiClient } from "@/lib/api";
import { isAuthSessionError } from "@/lib/auth-client";
import { parseAllBlocks, type MessageSegment } from "@/components/chat/AssistantMessageContent";

interface AnsweredStep {
  question: PendingQuestion;
  answer: AnswerBody;
}

type GuidedProposal = {
  proposalId: string;
  description: string;
  networkId?: string;
  lookingFor?: string;
  youBring?: string;
  offering?: string;
  networks?: Array<{ id?: string; title?: string }>;
};

function asGuidedProposal(segment: MessageSegment): GuidedProposal | null {
  if (segment.type !== "intent_proposal") return null;
  const value = segment.data as IntentProposalDataWithExtras;
  return {
    proposalId: value.proposalId,
    description: value.description,
    ...(value.networkId ? { networkId: value.networkId } : {}),
    ...(typeof value.lookingFor === "string" ? { lookingFor: value.lookingFor } : {}),
    ...(typeof value.youBring === "string" ? { youBring: value.youBring } : {}),
    ...(typeof value.offering === "string" ? { offering: value.offering } : {}),
    ...(Array.isArray(value.networks) ? { networks: value.networks } : {}),
  };
}

type IntentProposalDataWithExtras = {
  proposalId: string;
  description: string;
  networkId?: string;
  lookingFor?: string;
  youBring?: string;
  offering?: string;
  networks?: Array<{ id?: string; title?: string }>;
};

function latestProposal(messages: Array<{ content: string }>): GuidedProposal | null {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const segments = parseAllBlocks(messages[index].content);
    for (let segmentIndex = segments.length - 1; segmentIndex >= 0; segmentIndex -= 1) {
      const proposal = asGuidedProposal(segments[segmentIndex]);
      if (proposal) return proposal;
    }
  }
  return null;
}

function answerLabel(answer: AnswerBody): string {
  return [...answer.selectedOptions, answer.freeText?.trim() ?? ""].filter(Boolean).join(", ");
}

function GuidedQuestion({
  question,
  onAnswer,
  disabled,
}: {
  question: PendingQuestion;
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
      {question.payload.multiSelect && (
        <p className="mt-2 text-sm text-gray-500">Choose all that apply.</p>
      )}
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

function ProposalCard({
  proposal,
  networkTitle,
  lookingFor,
  youBring,
  onConfirm,
  onSkip,
  busy,
  error,
}: {
  proposal: GuidedProposal;
  networkTitle: string;
  lookingFor?: string;
  youBring?: string;
  onConfirm: () => Promise<void>;
  onSkip: () => Promise<void>;
  busy: boolean;
  error: string | null;
}) {
  const [skipping, setSkipping] = useState(false);
  const resolvedLookingFor = lookingFor ?? proposal.lookingFor ?? proposal.description;
  const resolvedYouBring = youBring ?? proposal.youBring ?? proposal.offering;
  return (
    <section aria-label="Confirm signal" className="mt-10 rounded-3xl border border-gray-200 bg-white p-6 shadow-sm sm:p-8">
      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-gray-400">One last look</p>
      <h1 className="mt-3 text-2xl font-semibold text-[#041729]">Does this feel right?</h1>
      <div className="mt-7 space-y-5">
        <Summary label="LOOKING FOR" value={resolvedLookingFor} />
        <Summary label="YOU BRING" value={resolvedYouBring ?? "Not specified"} />
        <Summary label="NETWORKS" value={networkTitle} />
      </div>
      {error && <p role="alert" className="mt-5 rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
      <div className="mt-7 flex flex-wrap items-center gap-3">
        <button
          type="button"
          disabled={busy || skipping}
          onClick={() => void onConfirm()}
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

export default function NewSignalPage() {
  const navigate = useNavigate();
  const { isAuthenticated, features, openLoginModal, signOut } = useAuthContext();
  const { indexes } = useNetworksState();
  const questionsService = useQuestionsService();
  const { addNotification, error: showError } = useNotifications();
  const {
    messages,
    liveQuestions,
    isLoading,
    startSignalSession,
    sendWebMessage,
    clearChat,
  } = useAIChat();
  const [answered, setAnswered] = useState<AnsweredStep[]>([]);
  const [proposalError, setProposalError] = useState<string | null>(null);
  const [kickoffError, setKickoffError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [skipped, setSkipped] = useState(false);
  const startedRef = useRef(false);

  const signalAgentEnabled = features?.signalAgent === true;

  const startKickoff = useCallback(() => {
    if (!isAuthenticated || !signalAgentEnabled || startedRef.current) return;
    startedRef.current = true;
    setKickoffError(null);
    startSignalSession();
    // Keep this marker stable: the Signal prompt builder uses it to enter the
    // live, three-round intake rather than treating this as ordinary chat.
    void sendWebMessage(
      "new-signal-kickoff",
      undefined,
      undefined,
      {
        hidden: true,
        persona: "signal",
        onError: (error) => {
          startedRef.current = false;
          if (isAuthSessionError(error)) {
            const callbackURL = typeof window === "undefined"
              ? "/i/new"
              : new URL("/i/new", window.location.origin).href;
            setKickoffError("Your session expired. Please sign in again.");
            showError("Session expired", "Please sign in again to start your signal.");
            void signOut()
              .catch(() => undefined)
              .finally(() => {
                navigate("/");
                openLoginModal(callbackURL);
              });
            return;
          }
          setKickoffError("We couldn't start your signal. Please try again.");
        },
      },
    );
  }, [isAuthenticated, navigate, openLoginModal, sendWebMessage, showError, signalAgentEnabled, signOut, startSignalSession]);

  useEffect(() => {
    startKickoff();
  }, [startKickoff]);

  const answeredIds = useMemo(() => new Set(answered.map((step) => step.question.id)), [answered]);
  const currentQuestion = liveQuestions.find((question) => !answeredIds.has(question.id)) ?? null;
  const proposal = useMemo(() => latestProposal(messages), [messages]);
  const selectedNetwork = useMemo(() => {
    const proposalNetwork = proposal?.networkId
      ? indexes.find((network) => network.id === proposal.networkId)
      : undefined;
    if (proposalNetwork) return proposalNetwork;

    const locationAnswer = answered[2]?.answer;
    const labels = [
      ...(locationAnswer?.selectedOptions ?? []),
      locationAnswer?.freeText?.trim() ?? "",
    ].filter(Boolean);
    return indexes.find((network) => labels.some((label) =>
      label.localeCompare(network.title, undefined, { sensitivity: "accent" }) === 0,
    ));
  }, [answered, indexes, proposal]);

  const networkTitle = selectedNetwork?.title ?? "Everywhere";
  const lookingFor = answered[0] ? answerLabel(answered[0].answer) : undefined;
  const answeredContribution = answered[1] ? answerLabel(answered[1].answer) : undefined;

  const handleAnswer = useCallback(async (body: AnswerBody) => {
    if (!currentQuestion) return;
    const question = currentQuestion;
    const response = await questionsService.answer(question.id, body);
    setAnswered((current) => [...current.filter((step) => step.question.id !== question.id), { question, answer: body }]);
    if (!response.resumed && !isLoading) {
      const parts = [...body.selectedOptions, body.freeText?.trim() ?? ""].filter(Boolean);
      if (parts.length) void sendWebMessage(`Re: "${question.payload.prompt}" — ${parts.join("; ")}`);
    }
  }, [currentQuestion, isLoading, questionsService, sendWebMessage]);

  const handleConfirm = useCallback(async () => {
    if (!proposal || confirming) return;
    setConfirming(true);
    setProposalError(null);
    const networkId = selectedNetwork?.id;
    try {
      const response = await apiClient.post<{ intentId: string }>("/intents/confirm", {
        proposalId: proposal.proposalId,
        description: proposal.description,
        ...(networkId ? { networkId } : {}),
      });
      addNotification({
        type: "intent_broadcast",
        title: networkId ? `Broadcasting to ${networkTitle}` : "Evaluating networks…",
        message: proposal.description,
        duration: 10000,
        onAction: async () => {
          await apiClient.patch(`/intents/${response.intentId}/archive`);
          clearChat();
          navigate("/i/new");
        },
      });
      navigate(`/i/${response.intentId}`);
    } catch (error) {
      setProposalError("Couldn't create your signal. Please try again.");
      showError("Signal creation failed", error instanceof Error ? error.message : "Please try again.");
    } finally {
      setConfirming(false);
    }
  }, [addNotification, clearChat, confirming, navigate, networkTitle, proposal, selectedNetwork, showError]);

  const handleSkip = useCallback(async () => {
    if (!proposal) return;
    try {
      await apiClient.post("/intents/reject", { proposalId: proposal.proposalId });
      setSkipped(true);
    } catch (error) {
      setProposalError("Couldn't dismiss this signal. Please try again.");
      showError("Signal dismissal failed", error instanceof Error ? error.message : "Please try again.");
    }
  }, [proposal, showError]);

  const startOver = useCallback(() => {
    clearChat();
    setAnswered([]);
    setProposalError(null);
    setKickoffError(null);
    setSkipped(false);
    startedRef.current = false;
  }, [clearChat]);

  if (!isAuthenticated || !signalAgentEnabled) return <Navigate to="/" replace />;

  return (
    <div className="min-h-screen bg-[#FDFDFD] px-5 py-6 sm:px-8 sm:py-10">
      <main className="mx-auto w-full max-w-2xl">
        <button
          type="button"
          onClick={() => navigate("/")}
          className="inline-flex items-center gap-1 text-sm text-gray-500 transition hover:text-[#041729]"
        >
          <ChevronLeft className="h-4 w-4" /> Back
        </button>
        <p className="mt-10 text-xs font-semibold uppercase tracking-[0.2em] text-gray-400">Start a new signal</p>
        <h1 className="mt-3 text-3xl font-semibold tracking-tight text-[#041729] sm:text-4xl">Make what you’re looking for legible.</h1>

        <div className="mt-8 flex gap-1.5" aria-label="Signal progress">
          {Array.from({ length: Math.max(4, answered.length + (currentQuestion ? 1 : 0)) }).map((_, index) => (
            <span
              key={index}
              className={`h-1.5 flex-1 rounded-full ${index < answered.length ? "bg-[#041729]" : index === answered.length && currentQuestion ? "bg-[#8BA8B8]" : "bg-gray-200"}`}
            />
          ))}
        </div>

        <div className="mt-10 space-y-5">
          {answered.map((step) => (
            <div key={step.question.id} className="border-b border-gray-100 pb-5">
              <p className="text-xs uppercase tracking-[0.16em] text-gray-400">{step.question.payload.prompt}</p>
              <p className="mt-1 text-base text-gray-700">{answerLabel(step.answer)}</p>
            </div>
          ))}
        </div>

        {skipped ? (
          <section className="mt-12 rounded-3xl border border-gray-200 bg-white p-8 text-center">
            <h2 className="text-xl font-semibold text-[#041729]">Nothing saved.</h2>
            <button type="button" onClick={startOver} className="mt-5 rounded-full bg-[#041729] px-5 py-2.5 text-sm text-white">Start over</button>
          </section>
        ) : proposal ? (
          <ProposalCard
            proposal={proposal}
            networkTitle={networkTitle}
            lookingFor={lookingFor}
            youBring={answeredContribution}
            onConfirm={handleConfirm}
            onSkip={handleSkip}
            busy={confirming}
            error={proposalError}
          />
        ) : currentQuestion ? (
          <GuidedQuestion question={currentQuestion} onAnswer={handleAnswer} disabled={isLoading && !currentQuestion} />
        ) : kickoffError ? (
          <section role="alert" className="mt-14 rounded-2xl border border-red-100 bg-red-50 p-5 text-sm text-red-800">
            <p>{kickoffError}</p>
            <button
              type="button"
              onClick={startKickoff}
              className="mt-4 rounded-full bg-[#041729] px-4 py-2 text-sm font-medium text-white"
            >
              Try again
            </button>
          </section>
        ) : isLoading ? (
          <div role="status" aria-label="Your agent is thinking" className="mt-14 flex items-center gap-3 text-sm text-gray-500">
            <Loader2 className="h-4 w-4 animate-spin" /> Your agent is thinking…
          </div>
        ) : (
          <div role="status" className="mt-14 text-sm text-gray-500">Your agent is preparing the next step…</div>
        )}
      </main>
    </div>
  );
}

export const Component = NewSignalPage;
