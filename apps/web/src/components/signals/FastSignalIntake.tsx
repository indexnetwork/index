import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Loader2 } from "lucide-react";

import { GuidedQuestion, ProposalCard, type GuidedProposal, type GuidedSignalConfirmation } from "@/components/signals/GuidedSignalIntake";
import { WherePicker } from "@/components/signals/WherePicker";
import { useNetworksState } from "@/contexts/IndexesContext";
import { useNotifications } from "@/contexts/NotificationContext";
import { apiClient } from "@/lib/api";
import { intakeService, type IntakeAnswerBody, type IntakeProposalResponse, type IntakeRound } from "@/services/intake";
import type { PendingQuestion, QuestionPayload } from "@/services/questions";

type Stage = "who" | "followup" | "where" | "clarify" | "proposal";

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
  /** Durable/local recovery ID for completion retries after a refresh. */
  resumeIntentId?: string | null;
}

/**
 * Deterministic intake: a precomputed round 1, a locked plan of up to n-1
 * generated follow-ups (served one per turn or as one batch), a client-side
 * community picker, and a proposal that synthesis has usually already
 * prepared speculatively in the background.
 */
export function FastSignalIntake({ onConfirmed, resumeIntentId }: FastSignalIntakeProps) {
  const { indexes } = useNetworksState();
  const { error: showError } = useNotifications();

  const [stage, setStage] = useState<Stage>("who");
  const [loadError, setLoadError] = useState<string | null>(null);
  const [whoQuestion, setWhoQuestion] = useState<QuestionPayload | null>(null);
  const [rounds, setRounds] = useState<IntakeRound[]>([]);
  const [currentQuestion, setCurrentQuestion] = useState<QuestionPayload | null>(null);
  const [queue, setQueue] = useState<QuestionPayload[]>([]);
  const [total, setTotal] = useState<number | null>(null);
  const [clarification, setClarification] = useState<QuestionPayload | null>(null);
  const [answeredSteps, setAnsweredSteps] = useState<AnsweredStep[]>([]);
  const [pendingChoice, setPendingChoice] = useState<WhereChoice | null>(null);
  const [runId, setRunId] = useState<string | null>(null);
  const [selectedNetworkId, setSelectedNetworkId] = useState<string | undefined>(undefined);
  const [proposal, setProposal] = useState<IntakeProposalResponse | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [skipped, setSkipped] = useState(false);

  const startedRef = useRef(false);
  const prepareRef = useRef<Promise<{ runId: string }> | null>(null);
  const resumeAttemptedRef = useRef(false);

  // The community picker offers communities, and a personal network is not one: it is the
  // user's own private space. Mirrors NetworksPanel's `!i.isPersonal` filter and
  // the server-side brief, which is built from `getNonPersonalNetworkIds`.
  const communities = useMemo(() => indexes.filter((item) => !item.isPersonal), [indexes]);

  // Depends only on identifiers already available at this point, so callbacks
  // declared further down (resume completion included) can safely list it as
  // a dependency without a temporal-dead-zone reference.
  const networkTitle = useMemo(() => {
    const network = selectedNetworkId ? indexes.find((item) => item.id === selectedNetworkId) : undefined;
    return network?.title ?? "Everywhere";
  }, [indexes, selectedNetworkId]);

  const loadStart = useCallback(() => {
    setLoadError(null);
    intakeService.start()
      .then(({ question }) => setWhoQuestion(question))
      .catch(() => setLoadError("We couldn't start your signal. Please try again."));
  }, []);

  useEffect(() => {
    // A resume ID means an earlier session already created and possibly
    // confirmed this intent; the funnel must not restart underneath it.
    if (resumeIntentId || startedRef.current) return;
    startedRef.current = true;
    loadStart();
  }, [loadStart, resumeIntentId]);

  // Mirrors the legacy resume branch: skip the funnel entirely and retry
  // completion for the exact already-created intent.
  const attemptResumeCompletion = useCallback(async () => {
    if (!resumeIntentId) return;
    setConfirming(true);
    setError(null);
    try {
      await onConfirmed({ intentId: resumeIntentId, proposal: null, networkTitle });
    } catch (caught) {
      setError("Your signal was saved, but setup could not finish. Retry to continue.");
      showError("Onboarding completion failed", caught instanceof Error ? caught.message : "Please try again.");
    } finally {
      setConfirming(false);
    }
  }, [networkTitle, onConfirmed, resumeIntentId, showError]);

  useEffect(() => {
    if (!resumeIntentId || resumeAttemptedRef.current) return;
    resumeAttemptedRef.current = true;
    void attemptResumeCompletion();
  }, [attemptResumeCompletion, resumeIntentId]);

  // Fires speculation and advances to the community picker once the question
  // budget is spent. Shared by the who-answer and follow-up-answer paths.
  const startPrepare = useCallback((allRounds: IntakeRound[]) => {
    setStage("where");
    const prepared = intakeService.prepare({ rounds: allRounds });
    prepareRef.current = prepared;
    prepared
      .then(({ runId: preparedRunId }) => setRunId(preparedRunId))
      .catch(() => setError("Couldn't prepare your signal. Please try again."));
  }, []);

  // Consumes the queued batch; refetches only when the queue is empty and the
  // locked total says more rounds remain.
  const advance = useCallback(async (nextRounds: IntakeRound[], queueAfter: QuestionPayload[], knownTotal: number | null) => {
    if (queueAfter.length > 0) {
      setCurrentQuestion(queueAfter[0]);
      setQueue(queueAfter.slice(1));
      return;
    }
    if (knownTotal !== null && nextRounds.length >= knownTotal) {
      startPrepare(nextRounds);
      return;
    }
    try {
      const { questions, total: planTotal } = await intakeService.question(
        nextRounds,
        knownTotal ?? undefined,
      );
      setTotal(planTotal);
      if (questions.length === 0 || nextRounds.length >= planTotal) {
        startPrepare(nextRounds);
        return;
      }
      setCurrentQuestion(questions[0]);
      setQueue(questions.slice(1));
      setStage("followup");
    } catch {
      setError("Couldn't load the next question. Please try again.");
    }
  }, [startPrepare]);

  const handleWhoAnswer = useCallback(async (answer: IntakeAnswerBody) => {
    if (!whoQuestion) return;
    setError(null);
    const nextRounds = [{ prompt: whoQuestion.prompt, answer }];
    setRounds(nextRounds);
    setAnsweredSteps([{ prompt: whoQuestion.prompt, answer }]);
    await advance(nextRounds, [], null);
  }, [whoQuestion, advance]);

  const handleFollowupAnswer = useCallback(async (answer: IntakeAnswerBody) => {
    if (!currentQuestion) return;
    setError(null);
    const nextRounds = [...rounds, { prompt: currentQuestion.prompt, answer }];
    setRounds(nextRounds);
    setAnsweredSteps((current) => [...current, { prompt: currentQuestion.prompt, answer }]);
    await advance(nextRounds, queue, total);
  }, [currentQuestion, rounds, queue, total, advance]);

  // A rejected verification is recoverable: show the clarification, then retry
  // the same choice once it is answered.
  const resolve = useCallback(async (choice: WhereChoice, roundsOverride?: IntakeRound[]) => {
    const effectiveRounds = roundsOverride ?? rounds;
    if (effectiveRounds.length === 0) return;
    setBusy(true);
    setError(null);
    try {
      let effectiveRunId = runId;
      if (!effectiveRunId && prepareRef.current) {
        effectiveRunId = (await prepareRef.current).runId;
      }
      if (!effectiveRunId) throw new Error("Signal preparation is unavailable.");
      const result = await intakeService.proposal({
        runId: effectiveRunId, rounds: effectiveRounds, ...choice,
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
  }, [rounds, runId]);

  const handleWhereSelect = useCallback((choice: WhereChoice) => {
    void resolve(choice);
  }, [resolve]);

  // Clarification merges into the LAST round's answer; it does not start a new
  // round and does not count toward the locked total.
  const handleClarificationAnswer = useCallback(async (answer: IntakeAnswerBody) => {
    if (!clarification) return;
    const clarificationText = answerLabel(answer);
    const mergedRounds = rounds.map((round, index) => index === rounds.length - 1
      ? { ...round, answer: {
          selectedOptions: round.answer.selectedOptions,
          ...((round.answer.freeText || clarificationText)
            ? { freeText: [round.answer.freeText, clarificationText].filter(Boolean).join(" — ") }
            : {}),
        } }
      : round);
    setRounds(mergedRounds);
    setAnsweredSteps((current) => [...current, { prompt: clarification.prompt, answer }]);
    setClarification(null);
    await resolve(pendingChoice ?? {}, mergedRounds);
  }, [rounds, clarification, pendingChoice, resolve]);

  // Controller resolution 1: a non-empty server value must win over the raw
  // option-label join, so the explicit prop is only supplied as a fallback
  // when the server's synthesis came back empty (the clean speculative-hit
  // branch). ProposalCard resolves `lookingFor ?? proposal.lookingFor ??
  // proposal.description`, so leaving these `undefined` lets the richer
  // server copy carried on `proposalForCard` win instead of being shadowed.
  const lookingFor = proposal?.lookingFor?.trim() ? undefined : (rounds[0] ? answerLabel(rounds[0].answer) : undefined);
  const youBring = proposal?.youBring?.trim() ? undefined : (rounds[1] ? answerLabel(rounds[1].answer) : undefined);

  const proposalForCard: GuidedProposal | null = useMemo(() => (proposal ? {
    proposalId: proposal.proposalId,
    description: proposal.description,
    ...(selectedNetworkId ? { networkId: selectedNetworkId } : {}),
    ...(proposal.lookingFor ? { lookingFor: proposal.lookingFor } : {}),
    ...(proposal.youBring ? { youBring: proposal.youBring } : {}),
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
    if (!runId || rounds.length === 0) return;
    setBusy(true);
    setError(null);
    try {
      // Revise replaces the proposal row server-side, so the already-picked
      // community has to travel with it or the confirm below would 409 on the
      // proposal/network equality check.
      const result = await intakeService.revise({
        runId, rounds, feedback,
        ...(selectedNetworkId ? { networkId: selectedNetworkId } : {}),
      });
      setProposal(result);
    } catch {
      setError("Couldn't revise your signal. Please try again.");
    } finally {
      setBusy(false);
    }
  }, [rounds, runId, selectedNetworkId]);

  // Mirrors the legacy chat path: skipping rejects the durable proposal
  // server-side before landing on a terminal "nothing saved" state, rather
  // than silently orphaning the pending row.
  const handleSkip = useCallback(async () => {
    if (!proposal) return;
    try {
      await apiClient.post("/intents/reject", { proposalId: proposal.proposalId });
      setSkipped(true);
    } catch (caught) {
      setError("Couldn't dismiss this signal. Please try again.");
      showError("Signal dismissal failed", caught instanceof Error ? caught.message : "Please try again.");
    }
  }, [proposal, showError]);

  const startOver = useCallback(() => {
    setStage("who");
    setLoadError(null);
    setWhoQuestion(null);
    setRounds([]);
    setCurrentQuestion(null);
    setQueue([]);
    setTotal(null);
    setClarification(null);
    setAnsweredSteps([]);
    setPendingChoice(null);
    setRunId(null);
    setSelectedNetworkId(undefined);
    setProposal(null);
    setError(null);
    setSkipped(false);
    prepareRef.current = null;
    loadStart();
  }, [loadStart]);

  // The Math.max guard covers clarification steps, which do not count toward `total`.
  const progressSteps = total === null
    ? Math.max(4, answeredSteps.length + (stage === "proposal" ? 0 : 1))
    : Math.max(total + 2, answeredSteps.length + (stage === "proposal" ? 0 : 1));

  if (resumeIntentId) {
    return (
      <section className="mt-12 rounded-3xl border border-gray-200 bg-white p-8 text-center">
        {confirming ? (
          <div role="status" className="flex items-center justify-center gap-3 text-sm text-gray-500">
            <Loader2 className="h-4 w-4 animate-spin" /> Finishing setup…
          </div>
        ) : (
          <>
            <h2 className="text-xl font-semibold text-[#041729]">Your first signal is saved.</h2>
            {error && <p role="alert" className="mt-4 text-sm text-red-700">{error}</p>}
            <button
              type="button"
              onClick={() => void attemptResumeCompletion()}
              className="mt-5 rounded-full bg-[#041729] px-5 py-2.5 text-sm text-white"
            >
              Retry completion
            </button>
          </>
        )}
      </section>
    );
  }

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

      {skipped ? (
        <section className="mt-12 rounded-3xl border border-gray-200 bg-white p-8 text-center">
          <h2 className="text-xl font-semibold text-[#041729]">Nothing saved.</h2>
          <button type="button" onClick={startOver} className="mt-5 rounded-full bg-[#041729] px-5 py-2.5 text-sm text-white">Start over</button>
        </section>
      ) : stage === "proposal" && proposalForCard ? (
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
        <WherePicker networks={communities} onSelect={handleWhereSelect} busy={busy} />
      ) : stage === "clarify" && clarification ? (
        <GuidedQuestion
          question={toPendingQuestion("clarification", clarification)}
          onAnswer={handleClarificationAnswer}
          disabled={busy}
        />
      ) : stage === "followup" && currentQuestion ? (
        <GuidedQuestion
          question={toPendingQuestion(`followup-${rounds.length}`, currentQuestion)}
          onAnswer={handleFollowupAnswer}
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
