"use client";

import React, { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Index as IndexType } from "@/lib/types";
import { useNotifications } from "@/contexts/NotificationContext";
import { useIndexService } from "@/services/indexes";
import { useIndexesState } from "@/contexts/IndexesContext";
import { OnboardingStep } from "@/lib/onboardingTypes";
import { MOCK_INDEXES } from "./config";
import { useOnboardingContext } from "@/contexts/OnboardingContext";
import IndexCard from "./components/Index";

interface JoinIndexesStepProps {
  handleCompleteOnboarding: () => Promise<void>;
}

export default function JoinIndexesStep({
  handleCompleteOnboarding,
}: JoinIndexesStepProps) {
  const indexService = useIndexService();
  const { success, error } = useNotifications();
  const { currentStep, getPreviousStep, setCurrentStep } = useOnboardingContext();
  const { refreshIndexes } = useIndexesState();

  // Public indexes for join_indexes step
  const [publicIndexes, setPublicIndexes] = useState<Array<IndexType & { isMember?: boolean }>>([]);
  const [publicIndexesLoaded, setPublicIndexesLoaded] = useState(false);
  const [isJoiningIndex, setIsJoiningIndex] = useState<string | null>(null);
  const [selectedIndexes, setSelectedIndexes] = useState<Set<string>>(new Set());

  // Load public indexes when on join_indexes step
  useEffect(() => {
    const loadPublicIndexes = async () => {
      if (currentStep === OnboardingStep.JoinIndexes && !publicIndexesLoaded) {
        try {
          const response = await indexService.discoverPublicIndexes(1, 20);
          setPublicIndexes(response.indexes || []);
          setPublicIndexesLoaded(true);
        } catch (error) {
          console.error('Failed to load public indexes:', error);
          // Keep mock data as fallback
          setPublicIndexesLoaded(true);
        }
      }
    };

    loadPublicIndexes();
  }, [currentStep, publicIndexesLoaded, indexService]);

  const indexesToShow =
    publicIndexes.length > 0
      ? publicIndexes
      : MOCK_INDEXES.map((m) => ({
          id: m.id,
          title: m.name,
          prompt: m.description,
          permissions: null,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          user: { id: "", name: "", email: null, avatar: null },
          _count: { members: m.members, files: 0 },
          isMember: false,
        }));

  const handleToggleJoin = async (
    index: (typeof indexesToShow)[number]
  ) => {
    // Just toggle for mock data
    if (
      !publicIndexes.length &&
      MOCK_INDEXES.find((m) => m.id === index.id)
    ) {
      setSelectedIndexes(prev => {
        const next = new Set(prev);
        if (next.has(index.id)) {
          next.delete(index.id);
        } else {
          next.add(index.id);
        }
        return next;
      });

      return;
    }

    // Already joined, don't do anything
    if (index.isMember || selectedIndexes.has(index.id)) {
      return;
    }

    try {
      setIsJoiningIndex(index.id);
      await indexService.joinIndex(index.id);
      setSelectedIndexes(prev => new Set(prev).add(index.id));
      success(`Joined ${index.title}!`);
      // Update the index in the list
      setPublicIndexes(prev => prev.map(idx =>
        idx.id === index.id ? { ...idx, isMember: true } : idx
      ));
      // Refresh indexes context
      await refreshIndexes();
    } catch (err) {
      console.error('Failed to join index:', err);
      error('Failed to join index');
    } finally {
      setIsJoiningIndex(null);
    }
  };

  return (
    <div className="max-w-4xl mx-auto">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-black mb-4 font-ibm-plex-mono">Step into the right indexes</h1>
        <p className="text-black text-[14px] font-ibm-plex-mono">
        Based on your profile, here are networks where people are already sharing opportunities and ideas.
        </p>
      </div>

      {!publicIndexesLoaded ? (
        <div className="flex justify-center py-12">
          <div className="h-8 w-8 border-2 border-gray-300 border-t-black rounded-full animate-spin" />
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 mb-8">
          {indexesToShow.map((index) => {
            const isJoined = index.isMember || selectedIndexes.has(index.id);
            const isJoining = isJoiningIndex === index.id;

            return (
              <IndexCard
                key={index.id}
                index={index}
                isJoined={isJoined}
                isJoining={isJoining}
                onToggleJoin={handleToggleJoin}
              />
            );
          })}
        </div>
      )}

      <div className="flex gap-3">
        <Button
          variant="outline"
          onClick={() => setCurrentStep(getPreviousStep(OnboardingStep.JoinIndexes))}
          className="flex-1 border-[#E0E0E0] text-black hover:bg-[#F0F0F0] font-ibm-plex-mono"
        >
          Back
        </Button>
        <Button
          onClick={handleCompleteOnboarding}
          className="flex-1 bg-[#000] text-white hover:bg-black font-ibm-plex-mono"
        >
          See who's in here
        </Button>
      </div>
    </div>
  );
}
