"use client";

import React, { useEffect, useState, useCallback } from "react";
import { Button } from "@/components/ui/button";
import Image from "next/image";
import { useOnboardingContext } from "@/contexts/OnboardingContext";
import { OnboardingStep } from "@/types/onboarding";
import { useAuthenticatedAPI } from "@/lib/api";
import { useNotifications } from "@/contexts/NotificationContext";
import { useAuthContext } from "@/contexts/AuthContext";

interface InviteMembersStepProps {
  setCurrentStep: (step: OnboardingStep) => void;
  getPreviousStep: (step: OnboardingStep) => OnboardingStep;
  handleCompleteOnboarding: () => Promise<void>;
}

export default function InviteMembersStep({
  setCurrentStep,
  getPreviousStep,
  handleCompleteOnboarding,
}: InviteMembersStepProps) {
  const api = useAuthenticatedAPI();
  const { success } = useNotifications();
  const { user } = useAuthContext();
  const { createdIndex } = useOnboardingContext();

  // Local state for invite members step
  const [summaryLoaded, setSummaryLoaded] = useState(false);
  const [displayIntents, setDisplayIntents] = useState<
    Array<{
      id: string;
      payload: string;
      summary?: string;
      isIncognito: boolean;
      createdAt: string;
      updatedAt: string;
    }>
  >([]);
  const [displayMembers, setDisplayMembers] = useState<
    Array<{ id: string; name: string; avatar: string | null }>
  >([]);
  const [displayTotalIntents, setDisplayTotalIntents] = useState(0);
  const [inviteMethod, setInviteMethod] = useState<"automatic" | "link" | null>(
    null
  );

  // Load index summary for invite members step
  const loadIndexSummary = useCallback(async () => {
    try {
      const wasLoaded = summaryLoaded;
      if (!wasLoaded) {
        setSummaryLoaded(false);
      }

      // Get indexId from user onboarding state or createdIndex state
      const indexId = user?.onboarding?.indexId || createdIndex?.id;

      if (!indexId) {
        // If no indexId, we can't load summary - this will be handled by the component
        return;
      }

      const response = await api.get<{
        exampleIntents: Array<{
          id: string;
          payload: string;
          summary?: string;
          isIncognito: boolean;
          createdAt: string;
          updatedAt: string;
        }>;
        totalIntents: number;
        members: Array<{ id: string; name: string; avatar: string | null }>;
      }>(`/indexes/${indexId}/summary`);

      const newIntents = response.exampleIntents || [];
      const newMembers = response.members || [];
      const newTotalIntents = response.totalIntents || 0;

      // Only update display values if there are meaningful changes or first load
      if (
        !wasLoaded ||
        JSON.stringify(newIntents) !== JSON.stringify(displayIntents) ||
        JSON.stringify(newMembers) !== JSON.stringify(displayMembers) ||
        newTotalIntents !== displayTotalIntents
      ) {
        setDisplayIntents(newIntents);
        setDisplayMembers(newMembers);
        setDisplayTotalIntents(newTotalIntents);
      }

      if (!wasLoaded) {
        setSummaryLoaded(true);
      }
    } catch (err) {
      console.error("Failed to fetch index summary:", err);
      // Fallback to empty data only on first load
      if (!summaryLoaded) {
        setDisplayIntents([]);
        setDisplayMembers([]);
        setDisplayTotalIntents(0);
        setSummaryLoaded(true);
      }
    }
  }, [
    api,
    createdIndex?.id,
    summaryLoaded,
    displayIntents,
    displayMembers,
    displayTotalIntents,
    user?.onboarding?.indexId,
  ]);

  const handleInviteMembers = useCallback(() => {
    if (inviteMethod === "automatic") {
      // In a real implementation, this would send invites
      success("Invitations will be sent!");
    } else if (inviteMethod === "link") {
      success("Invite link copied to clipboard!");
      if (createdIndex?.inviteCode) {
        const inviteLink = `${window.location.origin}/l/${createdIndex.inviteCode}`;
        navigator.clipboard.writeText(inviteLink);
      }
    }
  }, [inviteMethod, success, createdIndex?.inviteCode]);

  // Load index summary when component mounts and reload every second
  useEffect(() => {
    // Load immediately
    loadIndexSummary();

    // Set up interval to reload every second
    const interval = setInterval(() => {
      loadIndexSummary();
    }, 1000);

    // Cleanup interval when component unmounts
    return () => clearInterval(interval);
  }, [loadIndexSummary]);

  return (
    <div className="max-w-3xl mx-auto">
      <div className="mb-2">
        <h1 className="text-2xl font-bold text-black mb-4 font-ibm-plex-mono">
          You're all set—here's a quick snapshot.
        </h1>
        {summaryLoaded && displayIntents.length > 0 ? (
          <p className="text-black text-[14px] font-ibm-plex-mono mb-2">
            Here are <strong>your intents</strong> from your connected sources.
            You can{" "}
            <button
              type="button"
              onClick={() => loadIndexSummary()}
              className="inline p-0 m-0 align-baseline text-black italic underline hover:opacity-80 font-ibm-plex-mono text-[14px] bg-transparent border-0 cursor-pointer"
              style={{ display: "inline", background: "none" }}
            >
              edit or add more
            </button>{" "}
            anytime.
          </p>
        ) : summaryLoaded ? null : (
          <p className="text-black text-[14px] font-ibm-plex-mono mb-2">
            Loading your intents from connected sources...
          </p>
        )}
      </div>

      {/* Intent tags - only show if there are intents or still loading */}
      {(!summaryLoaded || displayIntents.length > 0) && (
        <div className="space-y-1.5 mb-4">
          {summaryLoaded
            ? displayIntents.map((intent) => (
                <span
                  key={intent.id}
                  className="inline-block text-left px-2 py-1 bg-[#E3F2FD] hover:bg-[#BBDEFB] transition-colors rounded-sm"
                >
                  <span className="text-[#1976D2] text-[13px] font-ibm-plex-mono">
                    {intent.summary || intent.payload}
                  </span>
                </span>
              ))
            : // Loading placeholders
              Array.from({ length: 5 }).map((_, index) => (
                <div
                  key={index}
                  className="px-2 py-2.5  bg-[#F5F5F5] rounded-sm animate-pulse mb-1.5"
                >
                  <div
                    className="h-[13px] bg-[#E0E0E0] rounded"
                    style={{ width: `${Math.random() * 200 + 200}px` }}
                  ></div>
                </div>
              ))}
        </div>
      )}

      {/* Member invitation section */}
      <div className="mt-6 mb-12">
        {summaryLoaded ? (
          displayMembers.length > 1 ? (
            <div className="mt-4">
              {/* Show member info when there are multiple members and intents */}
              <div>
                <span className="text-black text-[14px] font-ibm-plex-mono">
                  We found{" "}
                  {displayMembers.slice(0, 3).map((member, index) => (
                    <span key={member.id}>
                      <strong>{member.name}</strong>
                      {index < Math.min(3, displayMembers.length) - 1 &&
                      index < 2
                        ? ", "
                        : ""}
                    </span>
                  ))}
                  {displayMembers.length > 3 && (
                    <span>
                      {" "}
                      and{" "}
                      <strong>{displayMembers.length - 3} more members</strong>
                    </span>
                  )}{" "}
                  sharing{" "}
                  <strong>{displayTotalIntents.toLocaleString()}</strong>{" "}
                  intents.
                </span>
              </div>
              <p className="text-black text-[14px] font-ibm-plex-mono mb-4 mt-4">
                Now, invite them to add their intents! The more intents people
                share, the easier it becomes to discover each other and connect
                at the right moment.
              </p>

              <div className="flex gap-3">
                <Button
                  onClick={() => {
                    setInviteMethod("automatic");
                    handleInviteMembers();
                  }}
                  className="bg-[#1976D2] text-white hover:bg-[#1565C0] font-ibm-plex-mono"
                >
                  Invite Automatically
                </Button>
                <Button
                  onClick={() => {
                    setInviteMethod("link");
                    handleInviteMembers();
                  }}
                  variant="outline"
                  className="font-ibm-plex-mono"
                >
                  Copy invite link
                </Button>
              </div>
            </div>
          ) : (
            <div className="mt-4 flex flex-col items-center justify-center pb-8">
              <p className="text-black text-[14px] font-ibm-plex-mono mt-4">
                We're still processing your connected sources to generate your
                intents and find potential members. This usually takes a few
                minutes. Check back later to see your results.
              </p>
              <Image
                className="h-auto"
                src={"/loading2.gif"}
                alt="Loading..."
                width={300}
                height={200}
                style={{
                  mixBlendMode: "multiply",
                  imageRendering: "auto",
                }}
              />
            </div>
          )
        ) : (
          <div className="mt-4 mb-4">
            {/* Loading state */}
            <div className="flex items-center gap-3 mb-3">
              <div className="h-5 bg-[#F5F5F5] rounded animate-pulse w-64"></div>
            </div>
          </div>
        )}
      </div>

      <div className="flex gap-3">
        <Button
          variant="outline"
          onClick={() =>
            setCurrentStep(getPreviousStep("invite_members" as OnboardingStep))
          }
          className="flex-1 border-[#E0E0E0] text-black hover:bg-[#F0F0F0] font-ibm-plex-mono"
        >
          Back
        </Button>
        <Button
          onClick={handleCompleteOnboarding}
          className="flex-1 bg-[#000] text-white hover:bg-black font-ibm-plex-mono"
        >
          Complete setup
        </Button>
      </div>
    </div>
  );
}
