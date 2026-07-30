import { useCallback } from "react";
import { ChevronLeft } from "lucide-react";
import { Navigate, useNavigate } from "react-router";

import { FastSignalIntake } from "@/components/signals/FastSignalIntake";
import { GuidedSignalIntake, type GuidedSignalConfirmation } from "@/components/signals/GuidedSignalIntake";
import { useAIChat } from "@/contexts/AIChatContext";
import { useAuthContext } from "@/contexts/AuthContext";
import { useNotifications } from "@/contexts/NotificationContext";
import { apiClient } from "@/lib/api";
import { isAuthSessionError } from "@/lib/auth-client";

export default function NewSignalPage() {
  const navigate = useNavigate();
  const { isAuthenticated, features, openLoginModal, signOut } = useAuthContext();
  const { addNotification, error: showError } = useNotifications();
  const { startSignalSession, sendWebMessage, clearChat } = useAIChat();
  const signalAgentEnabled = features?.signalAgent === true;
  const fastSignalIntakeEnabled = features?.fastSignalIntake === true;

  const sendKickoff = useCallback(async () => {
    let sendError: unknown;
    await sendWebMessage(
      "new-signal-kickoff",
      undefined,
      undefined,
      {
        hidden: true,
        persona: "signal",
        onError: (error) => { sendError = error; },
      },
    );
    if (sendError) throw sendError;
  }, [sendWebMessage]);

  const sendFollowup = useCallback(
    (message: string) => sendWebMessage(message),
    [sendWebMessage],
  );

  const handleKickoffError = useCallback((error: unknown) => {
    if (!isAuthSessionError(error)) return;
    const callbackURL = typeof window === "undefined"
      ? "/i/new"
      : new URL("/i/new", window.location.origin).href;
    showError("Session expired", "Please sign in again to start your signal.");
    void signOut()
      .catch(() => undefined)
      .finally(() => {
        navigate("/");
        openLoginModal(callbackURL);
      });
  }, [navigate, openLoginModal, showError, signOut]);

  const handleConfirmed = useCallback(async ({
    intentId,
    proposal,
    networkId,
    networkTitle,
  }: GuidedSignalConfirmation) => {
    if (!proposal) throw new Error("Signal proposal is unavailable.");
    addNotification({
      type: "intent_broadcast",
      title: networkId ? `Broadcasting to ${networkTitle}` : "Evaluating networks…",
      message: proposal.description,
      duration: 10000,
      onAction: async () => {
        await apiClient.patch(`/intents/${intentId}/archive`);
        clearChat();
        navigate("/i/new");
      },
    });
    navigate(`/i/${intentId}`);
  }, [addNotification, clearChat, navigate]);

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

        {fastSignalIntakeEnabled ? (
          <FastSignalIntake onConfirmed={handleConfirmed} />
        ) : (
          <GuidedSignalIntake
            prepareSession={startSignalSession}
            sendKickoff={sendKickoff}
            sendFollowup={sendFollowup}
            onKickoffError={handleKickoffError}
            onConfirmed={handleConfirmed}
          />
        )}
      </main>
    </div>
  );
}

export const Component = NewSignalPage;
