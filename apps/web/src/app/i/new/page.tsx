import { useCallback } from "react";
import { ChevronLeft } from "lucide-react";
import { Navigate, useNavigate } from "react-router";

import { FastSignalIntake } from "@/components/signals/FastSignalIntake";
import { type GuidedSignalConfirmation } from "@/components/signals/GuidedSignalIntake";
import { useAuthContext } from "@/contexts/AuthContext";
import { useNotifications } from "@/contexts/NotificationContext";
import { apiClient } from "@/lib/api";

export default function NewSignalPage() {
  const navigate = useNavigate();
  const { isAuthenticated } = useAuthContext();
  const { addNotification } = useNotifications();

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
        navigate("/i/new");
      },
    });
    navigate(`/i/${intentId}`);
  }, [addNotification, navigate]);

  if (!isAuthenticated) return <Navigate to="/" replace />;

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

        <FastSignalIntake onConfirmed={handleConfirmed} />
      </main>
    </div>
  );
}

export const Component = NewSignalPage;
