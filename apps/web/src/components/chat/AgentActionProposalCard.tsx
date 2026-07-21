import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, Check, Loader2, RotateCcw } from "lucide-react";

import { cn } from "@/lib/utils";

export type AgentActionProposalActionType =
  | "retract_premise"
  | "narrow_signal"
  | "pause_signal";

/** Safe, display-only action data emitted in an agent_action_proposal fence. */
export interface AgentActionProposalAction {
  type: AgentActionProposalActionType;
  entityId: string;
  currentState: string;
  proposedOperation: string;
  skipped?: boolean;
  reason?: string;
  /** Known backend fields retained for wire compatibility, never used to confirm. */
  description?: string;
  evidence?: string;
}

export interface AgentActionProposalData {
  proposalId: string;
  actions: AgentActionProposalAction[];
}

export interface AgentActionProposalResult {
  type: AgentActionProposalActionType;
  entityId: string;
  operation: string;
  previousState: string;
  resultingState: string;
  outcome: "applied" | "alreadyDone" | "stale" | "skipped";
  reason?: string;
}

export interface AgentActionConfirmationResponse {
  success: true;
  proposalId: string;
  status: "consumed" | "replayed";
  results: AgentActionProposalResult[];
}

export interface AgentActionProposalResolutionResponse {
  success: true;
  proposalId: string;
  status: "pending" | "executing" | "consumed";
  actions: AgentActionProposalAction[];
  results: AgentActionProposalResult[] | null;
}

interface AgentActionProposalCardProps {
  card: AgentActionProposalData;
  onResolve?: (proposalId: string) => Promise<AgentActionProposalResolutionResponse>;
  onConfirm?: (proposalId: string) => Promise<AgentActionConfirmationResponse>;
}

/** Skeleton shown while an agent action proposal fence is still streaming. */
export function AgentActionProposalSkeleton() {
  return (
    <div
      data-testid="agent-action-proposal-loading"
      className="my-2 animate-pulse rounded-lg border border-gray-200 bg-white px-4 py-3 shadow-sm"
    >
      <div className="h-3 w-40 rounded bg-gray-200" />
      <div className="mt-3 h-3 w-full rounded bg-gray-100" />
      <div className="mt-2 h-3 w-2/3 rounded bg-gray-100" />
    </div>
  );
}

function actionLabel(type: AgentActionProposalActionType): string {
  switch (type) {
    case "retract_premise":
      return "Retract premise";
    case "narrow_signal":
      return "Narrow signal";
    case "pause_signal":
      return "Pause signal";
  }
}

function errorIsRetryable(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const candidate = error as { status?: unknown; response?: unknown };
  if (candidate.status === 409) return true;
  if (candidate.response && typeof candidate.response === "object") {
    return (candidate.response as { retryable?: unknown }).retryable === true;
  }
  return false;
}

/**
 * Displays a reporter cleanup request. The only mutation path is the explicit
 * owner confirmation callback, which receives the proposal id and nothing from
 * the display payload.
 */
export default function AgentActionProposalCard({ card, onResolve, onConfirm }: AgentActionProposalCardProps) {
  const [canonicalProposal, setCanonicalProposal] = useState<AgentActionProposalResolutionResponse | null>(null);
  const [resolutionState, setResolutionState] = useState<"loading" | "ready" | "error" | "missing">(onResolve ? "loading" : "missing");
  const [resolutionAttempt, setResolutionAttempt] = useState(0);
  const [confirmation, setConfirmation] = useState<AgentActionConfirmationResponse | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<"retryable" | "failed" | null>(null);

  useEffect(() => {
    let active = true;
    setCanonicalProposal(null);
    setConfirmation(null);
    setError(null);
    if (!onResolve) {
      setResolutionState("missing");
      return () => { active = false; };
    }
    setResolutionState("loading");
    void onResolve(card.proposalId)
      .then((resolved) => {
        if (!active) return;
        if (resolved.proposalId !== card.proposalId) {
          setResolutionState("error");
          return;
        }
        setCanonicalProposal(resolved);
        setResolutionState("ready");
      })
      .catch(() => {
        if (!active) return;
        setResolutionState("error");
      });
    return () => { active = false; };
  }, [card.proposalId, onResolve, resolutionAttempt]);

  const handleResolveRetry = useCallback(() => {
    if (!onResolve) return;
    setResolutionAttempt((attempt) => attempt + 1);
  }, [onResolve]);

  const handleConfirm = useCallback(async () => {
    if (!onConfirm || confirming) return;
    setConfirming(true);
    setError(null);
    try {
      setConfirmation(await onConfirm(card.proposalId));
    } catch (cause) {
      setError(errorIsRetryable(cause) ? "retryable" : "failed");
    } finally {
      setConfirming(false);
    }
  }, [card.proposalId, confirming, onConfirm]);

  if (resolutionState === "loading") return <AgentActionProposalSkeleton />;
  if (resolutionState === "missing") return null;
  if (resolutionState === "error" || !canonicalProposal) {
    return (
      <div
        data-testid="agent-action-proposal-resolution-error"
        className="my-2 flex items-center gap-3 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-xs text-red-700 shadow-sm"
        role="alert"
      >
        <AlertTriangle className="h-4 w-4 shrink-0" />
        <span>This action request could not be verified. No action is available.</span>
        <button type="button" onClick={handleResolveRetry} className="ml-auto inline-flex items-center gap-1 font-medium underline">
          <RotateCcw className="h-3.5 w-3.5" />
          Retry
        </button>
      </div>
    );
  }
  const existingResults = confirmation?.results ?? canonicalProposal.results ?? [];
  const showingPreviouslyConsumed = !confirmation && canonicalProposal.status === "consumed";
  const hasConfirmed = confirmation !== null || canonicalProposal.status === "consumed";

  return (
    <div
      data-testid="agent-action-proposal-card"
      className="my-2 overflow-hidden rounded-lg border border-gray-200 bg-white shadow-sm"
    >
      <div className="flex items-center justify-between gap-3 border-b border-gray-100 px-4 py-3">
        <div>
          <div className="text-[10px] font-semibold uppercase tracking-wider text-gray-500">
            Agent action request
          </div>
          <p className="mt-0.5 text-xs text-gray-500">Owner confirmation required · no action runs automatically</p>
        </div>
        {onConfirm && (
          <button
            type="button"
            onClick={handleConfirm}
            disabled={confirming}
            className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-[#041729] px-3 py-1.5 text-xs font-medium text-white hover:bg-[#16334a] disabled:cursor-wait disabled:opacity-60"
          >
            {confirming ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : hasConfirmed ? <RotateCcw className="h-3.5 w-3.5" /> : <Check className="h-3.5 w-3.5" />}
            {confirming ? "Confirming…" : hasConfirmed ? "Confirm again" : "Confirm"}
          </button>
        )}
      </div>

      <ol className="divide-y divide-gray-100">
        {canonicalProposal.actions.map((action) => (
          <li key={`${action.type}-${action.entityId}`} className="px-4 py-3 text-xs text-gray-700">
            <div className="flex items-start justify-between gap-3">
              <span className="font-medium text-gray-900">{actionLabel(action.type)}</span>
              <span className={cn("font-ibm-plex-mono text-[10px]", action.skipped ? "text-amber-600" : "text-gray-400")}>
                {action.skipped ? "Skipped" : action.proposedOperation}
              </span>
            </div>
            <div className="mt-1 font-ibm-plex-mono text-[10px] text-gray-500">
              {action.entityId} · current state: {action.currentState}
            </div>
            {action.type === "narrow_signal" && action.description && (
              <p className="mt-2 text-gray-800">
                <span className="font-medium">Replacement signal:</span> {action.description}
              </p>
            )}
            {action.evidence && <p className="mt-1 text-gray-500"><span className="font-medium">Evidence:</span> {action.evidence}</p>}
            {action.reason && <p className="mt-1 text-gray-500"><span className="font-medium">Reason:</span> {action.reason}</p>}
          </li>
        ))}
      </ol>

      {error && (
        <div className="flex items-center gap-2 border-t border-red-100 bg-red-50 px-4 py-3 text-xs text-red-700" role="alert">
          <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
          <span>{error === "retryable" ? "Confirmation is still in progress. Retry." : "Confirmation failed. Retry."}</span>
          <button type="button" onClick={handleConfirm} disabled={confirming} className="ml-auto font-medium underline">
            Retry
          </button>
        </div>
      )}

      {hasConfirmed && (
        <div className="border-t border-green-100 bg-green-50 px-4 py-3 text-xs text-green-800" role="status">
          <div className="font-medium">
            {confirmation?.status === "replayed"
              ? "Already confirmed — replayed safely."
              : showingPreviouslyConsumed
                ? "Already confirmed."
                : "Confirmed safely."}
          </div>
          <ul className="mt-2 space-y-1">
            {existingResults.map((result, index) => (
              <li key={`${result.type}-${result.entityId}-${index}`}>
                {result.operation}: {result.previousState} → {result.resultingState} ({result.outcome})
                {result.reason ? ` — ${result.reason}` : ""}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
