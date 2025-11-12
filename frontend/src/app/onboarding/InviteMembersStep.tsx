"use client";

import React, { useEffect, useState, useCallback, useRef } from "react";
import { Button } from "@/components/ui/button";
import { useOnboardingContext } from "@/contexts/OnboardingContext";
import { OnboardingStep, OnboardingMember } from "@/lib/onboardingTypes";
import { useAuthenticatedAPI } from "@/lib/api";
import { useNotifications } from "@/contexts/NotificationContext";
import { useAuthContext } from "@/contexts/AuthContext";
import MemberInvitationSection from "./components/MemberInvitationSection";

interface InviteMembersStepProps {
  handleCompleteOnboarding: () => Promise<void>;
}

export default function InviteMembersStep({
  handleCompleteOnboarding,
}: InviteMembersStepProps) {
  const api = useAuthenticatedAPI();
  const { success, error } = useNotifications();
  const { user } = useAuthContext();
  const { createdIndex, setCurrentStep, getPreviousStep } = useOnboardingContext();

  // Local state for invite members step
  const [wasSummaryLoaded, setWasSummaryLoaded] = useState(false);
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
  const [displayMembers, setDisplayMembers] = useState<OnboardingMember[]>([]);
  const [displayTotalIntents, setDisplayTotalIntents] = useState(0);

  const isFetchingSummary = useRef(false);
    
  // Load index summary for invite members step
  const loadIndexSummary = useCallback(async () => {
    if (isFetchingSummary.current) {
      return;
    }

    isFetchingSummary.current = true;

    try {
      if (!wasSummaryLoaded) {
        setWasSummaryLoaded(false);
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
        members: OnboardingMember[];
      }>(`/indexes/${indexId}/summary`);

      const newIntents = response.exampleIntents || [];
      const newMembers = response.members || [];
      const newTotalIntents = response.totalIntents || 0;

      // Only update display values if there are meaningful changes or first load
      if (
        !wasSummaryLoaded ||
        JSON.stringify(newIntents) !== JSON.stringify(displayIntents) ||
        JSON.stringify(newMembers) !== JSON.stringify(displayMembers) ||
        newTotalIntents !== displayTotalIntents
      ) {
        setDisplayIntents(newIntents);
        setDisplayMembers(newMembers);
        setDisplayTotalIntents(newTotalIntents);
      }

      if (!wasSummaryLoaded) {
        setWasSummaryLoaded(true);
      }
    } catch (err) {
      console.error("Failed to fetch index summary:", err);
      // Fallback to empty data only on first load
      if (!wasSummaryLoaded) {
        const fallbackIntents: Array<{ id: string; payload: string; summary?: string; isIncognito: boolean; createdAt: string; updatedAt: string }> = [];
        const fallbackMembers: OnboardingMember[] = [];
        
        
        setDisplayIntents(fallbackIntents);
        setDisplayMembers(fallbackMembers);
        setDisplayTotalIntents(0);
        setWasSummaryLoaded(true);
      }
    } finally {
      isFetchingSummary.current = false;
    }
  }, [
    api,
    createdIndex?.id,
    wasSummaryLoaded,
    displayIntents,
    displayMembers,
    displayTotalIntents,
    user?.onboarding?.indexId,
  ]);

  const handleInviteMembers = useCallback(
    async (method: "automatic" | "link") => {
      if (method === "automatic") {
        // In a real implementation, this would send invites
        success("Invitations will be sent!");
      } else if (method === "link") {
        if (createdIndex?.inviteCode) {
          const inviteLink = `${window.location.origin}/l/${createdIndex.inviteCode}`;
          if (!navigator.clipboard?.writeText) {
            error("Clipboard access is unavailable in this environment.");
            return;
          }
          try {
            await navigator.clipboard.writeText(inviteLink);
            success("Invite link copied to clipboard!");
          } catch (clipboardError) {
            console.error("Failed to copy invite link to clipboard:", clipboardError);
            error("Unable to copy invite link. Please copy it manually.");
          }
        } else {
          error("No invite code to copy!");
        }
      }
    },
    [success, error, createdIndex?.inviteCode]
  );

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
        {wasSummaryLoaded && displayIntents.length > 0 ? (
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
        ) : wasSummaryLoaded ? null : (
          <p className="text-black text-[14px] font-ibm-plex-mono mb-2">
            Loading your intents from connected sources...
          </p>
        )}
      </div>

      {/* Intent tags - only show if there are intents or still loading */}
      {(!wasSummaryLoaded || displayIntents.length > 0) && (
        <div className="space-y-1.5 mb-4">
          {wasSummaryLoaded
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
      <MemberInvitationSection
        wasSummaryLoaded={wasSummaryLoaded}
        displayMembers={displayMembers}
        displayTotalIntents={displayTotalIntents}
        handleInviteMembers={handleInviteMembers}
      />

      <div className="flex gap-3">
        <Button
          variant="outline"
          onClick={() =>
            setCurrentStep(getPreviousStep(OnboardingStep.InviteMembers))
          }
          className="flex-1 border-[#E0E0E0] text-black hover:bg-[#F0F0F0] font-ibm-plex-mono"
        >
          Back
        </Button>
        <Button
          onClick={handleCompleteOnboarding}
          className="flex-1 bg-black text-white hover:bg-black font-ibm-plex-mono"
        >
          Complete setup
        </Button>
      </div>
    </div>
  );
}
