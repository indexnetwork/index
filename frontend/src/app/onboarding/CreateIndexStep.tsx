import React, { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { OnboardingStep } from "@/types/onboarding";
import { useIndexService } from "@/services/indexes";
import { useAuthService } from "@/services/auth";
import { useAuthContext } from "@/contexts/AuthContext";
import { useIndexesState } from "@/contexts/IndexesContext";
import { useNotifications } from "@/contexts/NotificationContext";
import { useOnboardingContext } from "@/contexts/OnboardingContext";

interface CreateIndexStepProps {
  getNextStep: (currentStep: OnboardingStep) => OnboardingStep;
  getPreviousStep: (currentStep: OnboardingStep) => OnboardingStep;
  setCurrentStep: (step: OnboardingStep) => void;
  setIsLoading: (loading: boolean) => void;
  isLoading: boolean;
}

export default function CreateIndexStep({
  getNextStep,
  getPreviousStep,
  setCurrentStep,
  setIsLoading,
  isLoading,
}: CreateIndexStepProps) {
  const [indexName, setIndexName] = useState("");
  const [isPrivate, setIsPrivate] = useState(false);
  const indexService = useIndexService();
  const authService = useAuthService();
  const { user, refetchUser } = useAuthContext();
  const { refreshIndexes } = useIndexesState();
  const { success, error } = useNotifications();
  const { setCreatedIndex } = useOnboardingContext();

  const handleCreateIndex = async () => {
    if (!indexName.trim() || !user) return;

    setIsLoading(true);
    try {
      const createRequest = {
        title: indexName.trim(),
        joinPolicy: isPrivate ? ("invite_only" as const) : ("anyone" as const),
      };

      const response = await indexService.createIndex(createRequest);

      const indexData = {
        id: response.id,
        name: response.title,
        inviteCode: response.permissions?.invitationLink?.code,
      };

      setCreatedIndex(indexData);

      // Save index ID to onboarding state in database
      const nextStep = getNextStep("create_index");
      await authService.updateOnboardingState({
        indexId: indexData.id,
        currentStep: nextStep,
      });

      // Refresh indexes context to include the newly created index
      await refreshIndexes();

      // Refetch user to get updated onboarding state
      await refetchUser();

      success("Index created successfully!");
      setCurrentStep(nextStep);
    } catch (err) {
      console.error("Error creating index:", err);
      error("Failed to create index");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="max-w-2xl mx-auto">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-black mb-4 font-ibm-plex-mono">
          Create your index.
        </h1>
        <p className="text-black text-[14px] font-ibm-plex-mono mb-6">
          Create a space for your network to discover and share opportunities.
        </p>
      </div>

      <div className="space-y-6">
        <div>
          <label className="block text-sm font-bold text-black mb-3 font-ibm-plex-mono">
            Index Name
          </label>
          <Input
            type="text"
            placeholder="John"
            value={indexName}
            onChange={(e) => setIndexName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && indexName.trim() && !isLoading) {
                handleCreateIndex();
              }
            }}
            className="w-full"
          />
        </div>

        <div>
          <label className="block text-sm font-bold text-black mb-2 font-ibm-plex-mono">
            Choose who can discover
          </label>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
            <button
              type="button"
              onClick={() => setIsPrivate(false)}
              className={`border-2 p-4 rounded-md text-left transition-all ${
                !isPrivate
                  ? "border-[#007EFF] bg-white"
                  : "border-[#E0E0E0] bg-[#F8F9FA] hover:border-[#007EFF]"
              }`}
            >
              <div className="flex items-center gap-3 mb-2">
                <svg
                  width="20"
                  height="20"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  className={!isPrivate ? "text-[#007EFF]" : "text-black"}
                >
                  <circle cx="12" cy="12" r="10"></circle>
                  <path d="M12 6v6l4 2"></path>
                </svg>
                <h3
                  className={`font-bold font-ibm-plex-mono ${
                    !isPrivate ? "text-black" : "text-[#666]"
                  }`}
                >
                  Anyone can join
                </h3>
              </div>
              <p className="text-sm text-black font-ibm-plex-mono">
                People can discover and join your network freely.
              </p>
            </button>

            <button
              type="button"
              onClick={() => setIsPrivate(true)}
              className={`border-2 p-4 rounded-md text-left transition-all ${
                isPrivate
                  ? "border-[#007EFF] bg-white"
                  : "border-[#E0E0E0] bg-[#F8F9FA] hover:border-[#007EFF]"
              }`}
            >
              <div className="flex items-center gap-3 mb-2">
                <svg
                  width="20"
                  height="20"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  className={isPrivate ? "text-[#007EFF]" : "text-black"}
                >
                  <rect
                    x="3"
                    y="11"
                    width="18"
                    height="11"
                    rx="2"
                    ry="2"
                  ></rect>
                  <circle cx="12" cy="16" r="1"></circle>
                  <path d="m7 11 0-4a5 5 0 0 1 10 0v4"></path>
                </svg>
                <h3
                  className={`font-bold font-ibm-plex-mono ${
                    isPrivate ? "text-black" : "text-[#666]"
                  }`}
                >
                  Private
                </h3>
              </div>
              <p className="text-sm text-[#666] font-ibm-plex-mono">
                Only people you invited or people with the invitation link can
                join.
              </p>
            </button>
          </div>
        </div>
      </div>

      <div className="flex gap-3 mt-8">
        <Button
          variant="outline"
          onClick={() => setCurrentStep(getPreviousStep("create_index"))}
          className="flex-1 border-[#E0E0E0] text-black hover:bg-[#F0F0F0] font-ibm-plex-mono"
        >
          Back
        </Button>
        <Button
          onClick={handleCreateIndex}
          disabled={!indexName.trim() || isLoading}
          className="flex-1 bg-[#000] text-white hover:bg-black font-ibm-plex-mono"
        >
          {isLoading ? "Creating..." : "Next"}
        </Button>
      </div>
    </div>
  );
}
