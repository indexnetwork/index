import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowUp, Loader2, Square } from "lucide-react";
import { useNavigate } from "react-router";

import AssistantMessageContent from "@/components/chat/AssistantMessageContent";
import { FastSignalIntake } from "@/components/signals/FastSignalIntake";
import { GuidedSignalIntake, type GuidedSignalConfirmation } from "@/components/signals/GuidedSignalIntake";
import { ToolCallsDisplay } from "@/components/chat/ToolCallsDisplay";
import { Button } from "@/components/ui/button";
import { useAIChat } from "@/contexts/AIChatContext";
import { useNetworks } from "@/contexts/APIContext";
import { useAuthContext } from "@/contexts/AuthContext";
import { useNetworksState } from "@/contexts/IndexesContext";
import { useNotifications } from "@/contexts/NotificationContext";
import { apiClient } from "@/lib/api";
import { log } from "@/lib/logger";

import LegacyOnboardingPage from "./legacy-page";

const logger = log.page.from("onboarding");
const PROFILE_KICKOFF = "onboarding-profile-kickoff";
const SIGNAL_KICKOFF = "new-signal-kickoff";

function pendingIntentStorageKey(userId: string): string {
  return `index:onboarding:first-signal:${userId}`;
}

function readPendingIntentId(userId: string): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem(pendingIntentStorageKey(userId));
  } catch {
    return null;
  }
}

function writePendingIntentId(userId: string, intentId: string): void {
  try {
    window.localStorage.setItem(pendingIntentStorageKey(userId), intentId);
  } catch {
    // The server-side completion marker remains authoritative. Storage is only
    // a response-loss recovery aid for the narrow confirm→complete window.
  }
}

function clearPendingIntentId(userId: string): void {
  try {
    window.localStorage.removeItem(pendingIntentStorageKey(userId));
  } catch {
    // Best effort only.
  }
}

function RestrictedProfilePhase() {
  const { refetchUser } = useAuthContext();
  const { messages, isLoading, sendOnboardingMessage, stopStream, clearChat } = useAIChat();
  const [input, setInput] = useState("");
  const startedRef = useRef(false);
  const previousLoadingRef = useRef(isLoading);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;
    clearChat({ abortStream: true });
    void sendOnboardingMessage(PROFILE_KICKOFF, undefined, undefined, { hidden: true });
  }, [clearChat, sendOnboardingMessage]);

  useEffect(() => {
    if (previousLoadingRef.current && !isLoading) void refetchUser();
    previousLoadingRef.current = isLoading;
  }, [isLoading, refetchUser]);

  useEffect(() => {
    scrollRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isLoading]);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    const message = input.trim();
    if (!message || isLoading) return;
    setInput("");
    await sendOnboardingMessage(message);
  };

  return (
    <div className="flex min-h-screen flex-col bg-[#FDFDFD]">
      <header className="px-6 py-5 lg:px-8">
        <img src="/logos/logo-black-full.svg" alt="Index Network" width={160} height={28} />
      </header>
      <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col px-6 pb-32 pt-8 lg:px-8">
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-gray-400">Set up your profile</p>
        <h1 className="mt-3 text-3xl font-semibold tracking-tight text-[#041729] sm:text-4xl">
          Give your agent the context you approve.
        </h1>
        <p className="mt-3 max-w-2xl text-sm leading-relaxed text-gray-500">
          Public lookup is optional. You will review and approve the profile before anything is saved.
        </p>

        <div className="mt-10 space-y-6">
          {messages.map((message) => (
            <div key={message.id} className={message.role === "user" ? "flex justify-end" : "flex justify-start"}>
              {message.role === "user" ? (
                <div className="max-w-[80%] rounded-3xl border border-gray-200 bg-white px-4 py-2 text-sm text-gray-800">
                  {message.content}
                </div>
              ) : (
                <div className="w-full text-gray-900">
                  <span className="mb-1 block text-[10px] font-bold uppercase tracking-wider text-black">Index</span>
                  {message.traceEvents && message.traceEvents.length > 0 && (
                    <ToolCallsDisplay
                      traceEvents={message.traceEvents}
                      isStreaming={message.isStreaming}
                      wasStoppedByUser={message.wasStoppedByUser}
                      stoppedAt={message.stoppedAt}
                    />
                  )}
                  <div className="max-w-[90%]">
                    <AssistantMessageContent content={message.content} isStreaming={message.isStreaming ?? false} />
                  </div>
                </div>
              )}
            </div>
          ))}
          {isLoading && messages.length === 0 && (
            <div role="status" className="flex items-center gap-3 text-sm text-gray-500">
              <Loader2 className="h-4 w-4 animate-spin" /> Preparing your private setup…
            </div>
          )}
          <div ref={scrollRef} />
        </div>
      </main>

      <div className="fixed inset-x-0 bottom-0 border-t border-gray-100 bg-white/95 px-6 py-4 backdrop-blur lg:px-8">
        <form onSubmit={submit} className="mx-auto flex w-full max-w-3xl items-end gap-3 rounded-3xl border border-gray-200 bg-[#FCFCFC] px-4 py-3">
          <textarea
            value={input}
            onChange={(event) => setInput(event.target.value)}
            placeholder="Reply to your onboarding agent"
            disabled={isLoading}
            rows={2}
            className="min-h-10 flex-1 resize-none bg-transparent text-sm text-gray-800 outline-none placeholder:text-gray-400 disabled:opacity-60"
          />
          {isLoading ? (
            <Button type="button" size="icon" onClick={stopStream} aria-label="Stop generating" className="h-8 w-8 rounded-full bg-[#041729] p-0 text-white">
              <Square className="h-4 w-4 fill-current" />
            </Button>
          ) : (
            <Button type="submit" size="icon" disabled={!input.trim()} aria-label="Send" className="h-8 w-8 rounded-full bg-[#041729] p-0 text-white disabled:opacity-40">
              <ArrowUp className="h-4 w-4" />
            </Button>
          )}
        </form>
      </div>
    </div>
  );
}

function RestrictedSignalPhase({ userId, durableIntentId }: { userId: string; durableIntentId?: string }) {
  const navigate = useNavigate();
  const { refetchUser, features } = useAuthContext();
  const fastSignalIntakeEnabled = features?.fastSignalIntake === true;
  const indexesService = useNetworks();
  const { refreshIndexes } = useNetworksState();
  const { error: showError } = useNotifications();
  const { clearChat, sendOnboardingMessage } = useAIChat();
  const resumeIntentId = useMemo(
    () => durableIntentId ?? readPendingIntentId(userId),
    [durableIntentId, userId],
  );

  const prepareSession = useCallback(() => clearChat({ abortStream: true }), [clearChat]);
  const sendKickoff = useCallback(
    () => sendOnboardingMessage(SIGNAL_KICKOFF, undefined, undefined, { hidden: true }),
    [sendOnboardingMessage],
  );
  const sendFollowup = useCallback(
    (message: string) => sendOnboardingMessage(message),
    [sendOnboardingMessage],
  );

  const handleConfirmed = useCallback(async ({ intentId }: GuidedSignalConfirmation) => {
    writePendingIntentId(userId, intentId);
    const completion = await apiClient.post<{
      success: boolean;
      error?: string;
      data?: { intentId?: string; completedAt?: string };
    }>("/tools/complete_onboarding", { query: { intentId } });
    if (!completion.success || completion.data?.intentId !== intentId || !completion.data.completedAt) {
      throw new Error(completion.error ?? "Onboarding completion was not acknowledged.");
    }

    // The completion tool awaits the users.onboarding write. Invitation work is
    // deliberately sequenced after that durable acknowledgement.
    await refetchUser();
    const pendingCode = localStorage.getItem("pendingInviteCode");
    if (pendingCode) {
      try {
        await indexesService.acceptInvitation(pendingCode);
        localStorage.removeItem("pendingInviteCode");
      } catch (error) {
        logger.error("Failed to accept deferred invitation", { error });
        showError("Could not join the network from your invitation link. Please try the link again.");
      }
    }
    await refreshIndexes();
    clearPendingIntentId(userId);
    navigate(`/i/${intentId}`, { replace: true });
  }, [indexesService, navigate, refetchUser, refreshIndexes, showError, userId]);

  return (
    <div className="min-h-screen bg-[#FDFDFD] px-5 py-8 sm:px-8 sm:py-12">
      <main className="mx-auto w-full max-w-2xl">
        <img src="/logos/logo-black-full.svg" alt="Index Network" width={160} height={28} />
        <p className="mt-12 text-xs font-semibold uppercase tracking-[0.2em] text-gray-400">Your first signal</p>
        <h1 className="mt-3 text-3xl font-semibold tracking-tight text-[#041729] sm:text-4xl">
          Tell your agent what connection matters first.
        </h1>
        {fastSignalIntakeEnabled ? (
          <FastSignalIntake onConfirmed={handleConfirmed} />
        ) : (
          <GuidedSignalIntake
            prepareSession={prepareSession}
            sendKickoff={sendKickoff}
            sendFollowup={sendFollowup}
            onConfirmed={handleConfirmed}
            resumeIntentId={resumeIntentId}
          />
        )}
      </main>
    </div>
  );
}

function CompletedOnboardingRedirect({ intentId }: { intentId?: string }) {
  const navigate = useNavigate();
  useEffect(() => {
    navigate(intentId ? `/i/${intentId}` : "/", { replace: true });
  }, [intentId, navigate]);
  return <div role="status" className="flex min-h-screen items-center justify-center text-sm text-gray-500">Opening your signal…</div>;
}

export default function OnboardingPage() {
  const { user, features } = useAuthContext();

  if (features?.signalAgent !== true) return <LegacyOnboardingPage />;
  if (!user) return null;
  if (user.onboarding?.completedAt) {
    return <CompletedOnboardingRedirect intentId={user.onboarding.firstSignalIntentId} />;
  }
  if (!user.onboarding?.profileConfirmedAt) return <RestrictedProfilePhase />;
  return (
    <RestrictedSignalPhase
      userId={user.id}
      durableIntentId={user.onboarding.firstSignalIntentId}
    />
  );
}

export const Component = OnboardingPage;
