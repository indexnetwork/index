import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Loader2 } from "lucide-react";

import { GuidedQuestion, ProposalCard, type GuidedProposal, type GuidedSignalConfirmation } from "@/components/signals/GuidedSignalIntake";
import { WherePicker } from "@/components/signals/WherePicker";
import { useNetworksState } from "@/contexts/IndexesContext";
import { apiClient } from "@/lib/api";
import { intakeService, type IntakeAnswerBody, type IntakeProposalResponse } from "@/services/intake";
import type { PendingQuestion, QuestionPayload } from "@/services/questions";

type Stage = "who" | "bring" | "where" | "clarify" | "proposal";

interface AnsweredStep {
  prompt: string;
  answer: IntakeAnswerBody;
}

interface WhereChoice {
  networkId?: string;
  whereText?: string;
}

function answerLabel(answer: IntakeAnswerBody): string {
  return [...answer.selectedOptions, answer.freeText?.trim() ?? ""].filter(Boolean).join(", ");
}

/** GuidedQuestion only reads `.payload`; the rest is inert filler for the shared type. */
function toPendingQuestion(id: string, payload: QuestionPayload): PendingQuestion {
  return {
    id,
    detection: { mode: "intent", sourceType: "fast-intake", sourceId: id, timestamp: new Date().toISOString() },
    actors: [],
    payload,
    status: "pending",
    answer: null,
    expiresAt: null,
    createdAt: new Date().toISOString(),
    conversationId: null,
  };
}

export interface FastSignalIntakeProps {
  /** Runs only after /intents/confirm returns the exact persisted intent ID. */
  onConfirmed: (confirmation: GuidedSignalConfirmation) => Promise<void>;
}

/**
 * Deterministic four-round intake: a precomputed round 1, one model call for
 * round 2, a client-side community picker for round 3, and a proposal that
 * synthesis has usually already prepared speculatively in the background.
 */
export function FastSignalIntake({ onConfirmed }: FastSignalIntakeProps) {
  const { indexes } = useNetworksState();

  const [stage, setStage] = useState<Stage>("who");
  const [loadError, setLoadError] = useState<string | null>(null);
  const [whoQuestion, setWhoQuestion] = useState<QuestionPayload | null>(null);
  const [bringQuestion, setBringQuestion] = useState<QuestionPayload | null>(null);
  const [clarification, setClarification] = useState<QuestionPayload | null>(null);
  const [answeredSteps, setAnsweredSteps] = useState<AnsweredStep[]>([]);
  const [whoAnswer, setWhoAnswer] = useState<IntakeAnswerBody | null>(null);
  const [bringAnswer, setBringAnswer] = useState<IntakeAnswerBody | null>(null);
  const [pendingChoice, setPendingChoice] = useState<WhereChoice | null>(null);
  const [runId, setRunId] = useState<string | null>(null);
  const [selectedNetworkId, setSelectedNetworkId] = useState<string | undefined>(undefined);
  const [proposal, setProposal] = useState<IntakeProposalResponse | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const startedRef = useRef(false);
  const prepareRef = useRef<Promise<{ runId: string }> | null>(null);

  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;
    intakeService.start()
      .then(({ question }) => setWhoQuestion(question))
      .catch(() => setLoadError("We couldn't start your signal. Please try again."));
  }, []);

  const handleWhoAnswer = useCallback(async (answer: IntakeAnswerBody) => {
    if (!whoQuestion) return;
    setError(null);
    try {
      const { question } = await intakeService.question(answer);
      setWhoAnswer(answer);
      setAnsweredSteps((current) => [...current, { prompt: whoQuestion.prompt, answer }]);
      setBringQuestion(question);
      setStage("bring");
    } catch {
      setError("Couldn't load the next question. Please try again.");
    }
  }, [whoQuestion]);

  // Round 2's answer starts speculation, then immediately advances to the
  // picker: the overlap between round 3 and synthesis is the entire point.
  const handleBringAnswer = useCallback(async (answer: IntakeAnswerBody) => {
    if (!bringQuestion || !whoAnswer) return;
    setBringAnswer(answer);
    setAnsweredSteps((current) => [...current, { prompt: bringQuestion.prompt, answer }]);
    setStage("where");
    const prepared = intakeService.prepare({
      whoAnswer, bringAnswer: answer, round2Prompt: bringQuestion.prompt,
    });
    prepareRef.current = prepared;
    try {
      const { runId: preparedRunId } = await prepared;
      setRunId(preparedRunId);
    } catch {
      setError("Couldn't prepare your signal. Please try again.");
    }
  }, [bringQuestion, whoAnswer]);

  // A rejected verification is recoverable: show the clarification, then retry
  // the same choice once it is answered.
  const resolve = useCallback(async (choice: WhereChoice, bringOverride?: IntakeAnswerBody) => {
    const effectiveBring = bringOverride ?? bringAnswer;
    if (!whoAnswer || !effectiveBring) return;
    setBusy(true);
    setError(null);
    try {
      let effectiveRunId = runId;
      if (!effectiveRunId && prepareRef.current) {
        effectiveRunId = (await prepareRef.current).runId;
      }
      if (!effectiveRunId) throw new Error("Signal preparation is unavailable.");
      const result = await intakeService.proposal({
        runId: effectiveRunId, whoAnswer, bringAnswer: effectiveBring, ...choice,
      });
      setSelectedNetworkId(choice.networkId);
      setProposal(result);
      setStage("proposal");
    } catch (caught) {
      const rejection = caught as { code?: string; clarification?: QuestionPayload };
      if (rejection.code === "verification_rejected" && rejection.clarification) {
        setClarification(rejection.clarification);
        setPendingChoice(choice);
        setStage("clarify");
        return;
      }
      setError("Couldn't build your signal. Please try again.");
    } finally {
      setBusy(false);
    }
  }, [bringAnswer, runId, whoAnswer]);

  const handleWhereSelect = useCallback((choice: WhereChoice) => {
    void resolve(choice);
  }, [resolve]);

  const handleClarificationAnswer = useCallback(async (answer: IntakeAnswerBody) => {
    if (!clarification) return;
    const clarificationText = answerLabel(answer);
    const merged: IntakeAnswerBody = {
      selectedOptions: bringAnswer?.selectedOptions ?? [],
      ...((bringAnswer?.freeText || clarificationText)
        ? { freeText: [bringAnswer?.freeText, clarificationText].filter(Boolean).join(" — ") }
        : {}),
    };
    setAnsweredSteps((current) => [...current, { prompt: clarification.prompt, answer }]);
    setBringAnswer(merged);
    setClarification(null);
    await resolve(pendingChoice ?? {}, merged);
  }, [bringAnswer, clarification, pendingChoice, resolve]);

  const networkTitle = useMemo(() => {
    const network = selectedNetworkId ? indexes.find((item) => item.id === selectedNetworkId) : undefined;
    return network?.title ?? "Everywhere";
  }, [indexes, selectedNetworkId]);

  const lookingFor = whoAnswer ? answerLabel(whoAnswer) : undefined;
  const youBring = bringAnswer ? answerLabel(bringAnswer) : undefined;

  const proposalForCard: GuidedProposal | null = useMemo(() => (proposal ? {
    proposalId: proposal.proposalId,
    description: proposal.description,
    ...(selectedNetworkId ? { networkId: selectedNetworkId } : {}),
  } : null), [proposal, selectedNetworkId]);

  const handleConfirm = useCallback(async (description: string) => {
    if (!proposalForCard || confirming) return;
    setConfirming(true);
    setError(null);
    try {
      const response = await apiClient.post<{ intentId: string }>("/intents/confirm", {
        proposalId: proposalForCard.proposalId,
        description,
        ...(selectedNetworkId ? { networkId: selectedNetworkId } : {}),
      });
      await onConfirmed({
        intentId: response.intentId,
        proposal: { ...proposalForCard, description },
        ...(selectedNetworkId ? { networkId: selectedNetworkId } : {}),
        networkTitle,
      });
    } catch {
      setError("Couldn't create your signal. Please try again.");
    } finally {
      setConfirming(false);
    }
  }, [confirming, networkTitle, onConfirmed, proposalForCard, selectedNetworkId]);

  const handleFeedback = useCallback(async (feedback: string) => {
    if (!runId || !whoAnswer || !bringAnswer) return;
    setBusy(true);
    setError(null);
    try {
      const result = await intakeService.revise({ runId, whoAnswer, bringAnswer, feedback });
      setProposal(result);
    } catch {
      setError("Couldn't revise your signal. Please try again.");
    } finally {
      setBusy(false);
    }
  }, [bringAnswer, runId, whoAnswer]);

  const handleSkip = useCallback(async () => {
    setProposal(null);
    setStage("where");
  }, []);

  const progressSteps = Math.max(4, answeredSteps.length + (stage === "proposal" ? 0 : 1));

  return (
    <>
      <div className="mt-8 flex gap-1.5" aria-label="Signal progress">
        {Array.from({ length: progressSteps }).map((_, index) => (
          <span
            key={index}
            className={`h-1.5 flex-1 rounded-full ${
              index < answeredSteps.length
                ? "bg-[#041729]"
                : index === answeredSteps.length && stage !== "proposal"
                  ? "bg-[#8BA8B8]"
                  : "bg-gray-200"
            }`}
          />
        ))}
      </div>

      {error && (
        <p role="alert" className="mt-5 rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>
      )}

      {stage === "proposal" && proposalForCard ? (
        <ProposalCard
          key={proposalForCard.proposalId}
          proposal={proposalForCard}
          networkTitle={networkTitle}
          lookingFor={lookingFor}
          youBring={youBring}
          onConfirm={handleConfirm}
          onFeedback={handleFeedback}
          onSkip={handleSkip}
          busy={confirming || busy}
          error={error}
        />
      ) : stage === "where" ? (
        <WherePicker networks={indexes} onSelect={handleWhereSelect} busy={busy} />
      ) : stage === "clarify" && clarification ? (
        <GuidedQuestion
          question={toPendingQuestion("clarification", clarification)}
          onAnswer={handleClarificationAnswer}
          disabled={busy}
        />
      ) : stage === "bring" && bringQuestion ? (
        <GuidedQuestion
          question={toPendingQuestion("bring", bringQuestion)}
          onAnswer={handleBringAnswer}
          disabled={busy}
        />
      ) : stage === "who" && whoQuestion ? (
        <GuidedQuestion
          question={toPendingQuestion("who", whoQuestion)}
          onAnswer={handleWhoAnswer}
          disabled={busy}
        />
      ) : loadError ? (
        <section role="alert" className="mt-14 rounded-2xl border border-red-100 bg-red-50 p-5 text-sm text-red-800">
          {loadError}
        </section>
      ) : (
        <div role="status" aria-label="Preparing your first question" className="mt-14 flex items-center gap-3 text-sm text-gray-500">
          <Loader2 className="h-4 w-4 animate-spin" /> Preparing your first question…
        </div>
      )}
    </>
  );
}
