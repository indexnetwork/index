import { useCallback, useEffect, useRef, useState } from "react";
import { Check, RotateCcw, Share2, X } from "lucide-react";

import { cn } from "@/lib/utils";

/** Data shape for an intent proposal returned by the create_intent chat tool. */
export interface IntentProposalData {
  proposalId: string;
  description: string;
  indexId?: string;
  confidence?: number | null;
  speechActType?: string | null;
}

interface IntentProposalCardProps {
  card: IntentProposalData;
  onApprove?: (proposalId: string, description: string, indexId?: string) => void | Promise<void>;
  onReject?: (proposalId: string) => void | Promise<void>;
  onUndo?: (proposalId: string) => void | Promise<void>;
  onShare?: (proposalId: string) => void | Promise<void>;
  currentStatus?: "pending" | "created" | "rejected";
}

/** Skeleton loader for intent proposal cards during streaming. */
export function IntentProposalSkeleton() {
  return (
    <div className="font-mono text-[11px] border border-gray-200 rounded-lg overflow-hidden bg-gray-900 text-gray-100 animate-pulse">
      <div className="flex items-center gap-2 px-3 py-1.5">
        <div className="w-3 h-3 bg-gray-700 rounded" />
        <div className="h-3 w-24 bg-gray-700 rounded" />
      </div>
      <div className="px-3 py-1.5 border-t border-gray-800">
        <div className="h-3 w-full bg-gray-700 rounded" />
      </div>
    </div>
  );
}

const COUNTDOWN_SECONDS = 5;

/**
 * Auto-save card for intent creation in chat.
 * Countdown from 5 with Skip option; auto-saves after countdown; Undo after save.
 */
export default function IntentProposalCard({
  card,
  onApprove,
  onReject,
  onUndo,
  onShare,
  currentStatus,
}: IntentProposalCardProps) {
  const [actionTaken, setActionTaken] = useState<"created" | "rejected" | null>(null);
  const [countdown, setCountdown] = useState<number | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [savingFor, setSavingFor] = useState<"approve" | "reject" | null>(null);
  const [isUndoing, setIsUndoing] = useState(false);
  const [actionError, setActionError] = useState(false);
  const [failedAction, setFailedAction] = useState<"approve" | "reject" | "undo" | null>(null);
  const [shareCopied, setShareCopied] = useState(false);
  const countdownStarted = useRef(false);
  const autoSaveTriggered = useRef(false);

  const statusResolved = currentStatus !== undefined;
  const effectiveStatus = currentStatus ?? (actionTaken ? actionTaken : "pending");
  const isPending = statusResolved && effectiveStatus === "pending" && !actionTaken && !actionError;

  // Start countdown on mount when pending
  useEffect(() => {
    if (!isPending || !onApprove || countdownStarted.current) return;
    countdownStarted.current = true;
    setCountdown(COUNTDOWN_SECONDS);
  }, [isPending, onApprove]);

  // Countdown tick
  useEffect(() => {
    if (countdown == null || countdown <= 0) return;
    const id = setInterval(() => {
      setCountdown((c) => (c == null ? c : c - 1));
    }, 1000);
    return () => clearInterval(id);
  }, [countdown]);

  // Auto-save when countdown reaches 0
  useEffect(() => {
    if (countdown !== 0 || !onApprove || autoSaveTriggered.current) return;
    autoSaveTriggered.current = true;
    setCountdown(null);
    setIsSaving(true);
    setSavingFor("approve");
    setActionError(false);

    (async () => {
      try {
        await onApprove(card.proposalId, card.description, card.indexId);
        setActionTaken("created");
      } catch {
        setActionError(true);
        setFailedAction("approve");
      } finally {
        setIsSaving(false);
        setSavingFor(null);
      }
    })();
  }, [countdown, card.proposalId, card.description, card.indexId, onApprove]);

  const handleSkip = useCallback(async () => {
    if (!onReject || isSaving) return;
    countdownStarted.current = true;
    autoSaveTriggered.current = true;
    setCountdown(null);
    setActionError(false);
    setIsSaving(true);
    setSavingFor("reject");
    try {
      await onReject(card.proposalId);
      setActionTaken("rejected");
    } catch {
      setActionError(true);
      setFailedAction("reject");
    } finally {
      setIsSaving(false);
      setSavingFor(null);
    }
  }, [onReject, card.proposalId, isSaving]);

  const handleApproveNow = useCallback(async () => {
    if (!onApprove || isSaving) return;
    countdownStarted.current = true;
    autoSaveTriggered.current = true;
    setCountdown(null);
    setActionError(false);
    setIsSaving(true);
    setSavingFor("approve");
    try {
      await onApprove(card.proposalId, card.description, card.indexId);
      setActionTaken("created");
    } catch {
      setActionError(true);
    } finally {
      setIsSaving(false);
      setSavingFor(null);
    }
  }, [onApprove, card.proposalId, card.description, card.indexId, isSaving]);

  const handleUndo = useCallback(async () => {
    if (!onUndo || isUndoing) return;
    setIsUndoing(true);
    setActionError(false);
    try {
      await onUndo(card.proposalId);
      setActionTaken("rejected");
    } catch {
      setActionError(true);
      setFailedAction("undo");
    } finally {
      setIsUndoing(false);
    }
  }, [onUndo, card.proposalId, isUndoing]);

  const handleShare = useCallback(async () => {
    if (!onShare) return;
    await onShare(card.proposalId);
    setShareCopied(true);
    setTimeout(() => setShareCopied(false), 2000);
  }, [onShare, card.proposalId]);

  if (actionError) {
    const errorLabel =
      failedAction === "reject" ? "Failed: Skip intent" :
      failedAction === "undo" ? "Failed: Undo intent" :
      "Failed: Create intent";
    const retryHandler =
      failedAction === "reject" ? handleSkip :
      failedAction === "undo" ? handleUndo :
      handleApproveNow;

    return (
      <div className="font-mono text-[11px] border border-gray-200 rounded-lg overflow-hidden bg-gray-900 text-gray-100 my-2">
        <div className="flex items-center gap-2 px-3 py-1.5 bg-red-900/10">
          <X className="w-3 h-3 text-red-500 shrink-0" />
          <span className="text-red-300">{errorLabel}</span>
        </div>
        <div className="px-3 py-2 border-t border-gray-800 flex gap-2">
          <button
            type="button"
            onClick={retryHandler}
            className="text-cyan-400 hover:underline"
          >
            Retry
          </button>
          {failedAction !== "reject" && onReject && (
            <button
              type="button"
              onClick={handleSkip}
              className="text-gray-500 hover:underline"
            >
              Skip
            </button>
          )}
        </div>
      </div>
    );
  }

  // Final stage — light pill style (also when saving for approve, to skip "Creating..." middle state)
  if (effectiveStatus === "created" || (isSaving && savingFor === "approve")) {
    return (
      <div className="my-2 rounded-lg bg-white border border-gray-200 px-4 py-3 shadow-sm">
        <div className="flex items-center justify-between gap-4">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-green-600">
              <span className="relative flex h-2 w-2">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-green-400 opacity-75" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-green-500" />
              </span>
              Broadcasting Signal
            </div>
            <p className="text-[14px] text-[#3D3D3D] leading-relaxed mt-0.5">
              {card.description || "No description provided"}
            </p>
          </div>
          <div className="flex items-center gap-3 shrink-0">
            {isSaving ? (
              <span className="text-xs text-gray-400">Saving…</span>
            ) : (
              <>
                {onShare && (
                  <button
                    type="button"
                    onClick={handleShare}
                    className="text-xs text-gray-400 hover:text-gray-500 flex items-center gap-1"
                  >
                    <Share2 className="w-3 h-3" />
                    {shareCopied ? "Copied!" : "Share"}
                  </button>
                )}
                {onUndo && (
                  <button
                    type="button"
                    onClick={handleUndo}
                    disabled={isUndoing}
                    className="text-xs text-gray-400 hover:text-gray-500 disabled:opacity-60"
                  >
                    {isUndoing ? "Undoing…" : "Undo"}
                  </button>
                )}
              </>
            )}
          </div>
        </div>
      </div>
    );
  }

  // Pending/Countdown/Error/Skipped — now also light pill style
  return (
    <div className="my-2 rounded-lg bg-white border border-gray-200 px-4 py-3 shadow-sm">
      <div className="flex items-center justify-between gap-4">
        <div className="min-w-0 flex-1">
          <div className="text-[10px] font-semibold uppercase tracking-wider text-gray-400">
            Proposed Intent
          </div>
          <p className={cn(
            "text-[14px] leading-relaxed mt-0.5",
            effectiveStatus === "rejected" ? "text-gray-400 line-through" : "text-[#3D3D3D]"
          )}>
            {card.description || "No description provided"}
          </p>
        </div>

        <div className="flex items-center gap-3 shrink-0">
          {((countdown != null && countdown > 0) || (countdown === null && isPending && !isSaving)) && (
            <>
              {onReject && (
                <button
                  type="button"
                  onClick={handleSkip}
                  className="text-xs text-gray-400 hover:text-gray-500"
                >
                  Skip
                </button>
              )}
              <button
                type="button"
                onClick={handleApproveNow}
                className="relative w-8 h-8 rounded-full bg-gray-100 border border-gray-300 flex items-center justify-center text-gray-500 hover:bg-gray-200 hover:text-gray-700 transition-colors overflow-hidden group"
                title="Create now"
              >
                <span className="text-xs font-medium group-hover:hidden z-10 relative tabular-nums">
                  {countdown ?? COUNTDOWN_SECONDS}
                </span>
                <Check className="w-4 h-4 z-10 relative hidden group-hover:block" />
                <svg className="absolute inset-[1px] pointer-events-none -rotate-90" viewBox="0 0 30 30">
                  <circle
                    cx="15"
                    cy="15"
                    r="14"
                    fill="none"
                    stroke="rgb(75,85,99)"
                    strokeWidth="1.5"
                    strokeDasharray="87.96"
                    strokeDashoffset={87.96 * (1 - (countdown ?? COUNTDOWN_SECONDS) / COUNTDOWN_SECONDS)}
                    className="transition-[stroke-dashoffset] duration-1000 linear"
                  />
                </svg>
              </button>
            </>
          )}

          {isSaving && savingFor === "reject" && (
            <span className="text-xs text-gray-400">Skipping…</span>
          )}

          {effectiveStatus === "rejected" && (
            <span className="text-xs text-gray-400">Skipped</span>
          )}
        </div>
      </div>
    </div>
  );
}
