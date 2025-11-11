"use client";

import React, { useState, useRef, useEffect, ChangeEvent } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import Image from "next/image";
import { getAvatarUrl } from "@/lib/file-utils";
import { useNotifications } from "@/contexts/NotificationContext";
import { useAuthContext } from "@/contexts/AuthContext";
import { useAuth as useAuthService } from "@/contexts/APIContext";
import { getSupportedFileExtensions, validateFiles } from "@/lib/file-validation";
import { OnboardingStep } from "@/types/onboarding";
import { useOnboardingContext } from "@/contexts/OnboardingContext";

interface ProfileStepProps {
  isLoading: boolean;
  setIsLoading: (loading: boolean) => void;
}

export default function ProfileStep({ isLoading, setIsLoading }: ProfileStepProps) {
  const { user, refetchUser } = useAuthContext();
  const authService = useAuthService();
  const { error } = useNotifications();
  const { currentFlow, getNextStep, setCurrentStep } = useOnboardingContext();

  // Profile step states
  const [name, setName] = useState('');
  const [intro, setIntro] = useState('');
  const [avatarFile, setAvatarFile] = useState<File | null>(null);
  const [avatarPreview, setAvatarPreview] = useState<string | null>(null);
  const [profileInitialized, setProfileInitialized] = useState(false);
  const lastSyncedUserRef = useRef<{
    id: string | null;
    name: string;
    intro: string;
  } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Initialize form fields when user data is available
  useEffect(() => {
    if (!user) {
      setName("");
      setIntro("");
      lastSyncedUserRef.current = null;
      setProfileInitialized(false);
      return;
    }

    const normalizedName = user.name ?? "";
    const normalizedIntro = user.intro ?? "";
    const snapshot = lastSyncedUserRef.current;
    const normalizedId = user.id ?? null;

    const shouldSyncProfile =
      !profileInitialized ||
      !snapshot ||
      snapshot.id !== normalizedId ||
      snapshot.name !== normalizedName ||
      snapshot.intro !== normalizedIntro;

    if (shouldSyncProfile) {
      setName(normalizedName);
      setIntro(normalizedIntro);
      lastSyncedUserRef.current = {
        id: normalizedId,
        name: normalizedName,
        intro: normalizedIntro,
      };
      setProfileInitialized(true);
    }
  }, [user, profileInitialized]);

  const uploadAvatar = async (file: File): Promise<string> => {
    return await authService.uploadAvatar(file);
  };

  const handleAvatarChange = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      // Validate avatar file
      const validation = validateFiles([file], 'avatar');
      if (!validation.isValid) {
        error(validation.message || 'Invalid file');
        e.target.value = '';
        return;
      }

      setAvatarFile(file);
      const reader = new FileReader();
      reader.onload = () => setAvatarPreview(reader.result as string);
      reader.readAsDataURL(file);
    }
  };

  const handleProfileSubmit = async () => {
    if (!user || !name.trim()) return;

    setIsLoading(true);
    try {
      let avatarFilename = user.avatar;

      if (avatarFile) {
        avatarFilename = await uploadAvatar(avatarFile);
      }

      const updatedUser = await authService.updateProfile({
        name: name.trim(),
        intro: intro.trim(),
        avatar: avatarFilename || undefined,
      });

      if (updatedUser) {
        // Save onboarding state: flow and next step
        const nextStep = getNextStep(OnboardingStep.Profile);
        await authService.updateOnboardingState({
          flow: currentFlow,
          currentStep: nextStep
        });

        // Refetch user data in AuthContext to keep it in sync
        await refetchUser();

        // Move to next step based on current flow
        setCurrentStep(nextStep);
      }
    } catch (err) {
      console.error('Error updating profile:', err);
      error('Failed to update profile');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="max-w-3xl mx-auto">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-black mb-2 font-ibm-plex-mono">Introduce yourself</h1>
        <p className="text-black text-[14px] font-ibm-plex-mono">
          Set up your profile to get started with Index Network.
        </p>
      </div>

      <div className="max-w-md space-y-6">
        <div className="flex">
          <div className="relative">
            <div className="w-20 h-20 rounded-full overflow-hidden bg-[#F5F5F5] flex items-center justify-center">
              {avatarPreview ? (
                <Image src={avatarPreview} alt="Avatar preview" width={80} height={80} className="w-full h-full object-cover" />
              ) : user?.avatar ? (
                <Image
                  src={getAvatarUrl(user)}
                  alt="Avatar"
                  width={80}
                  height={80}
                  className="w-full h-full object-cover"
                />
              ) : (
                <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-[#888]">
                  <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path>
                  <circle cx="12" cy="7" r="4"></circle>
                </svg>
              )}
            </div>
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="absolute -bottom-1 -right-1 w-6 h-6 bg-[#006D4B] text-white rounded-full flex items-center justify-center hover:bg-[#005A3E] transition-colors"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2-2z"></path>
                <circle cx="12" cy="13" r="4"></circle>
              </svg>
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept={getSupportedFileExtensions('avatar')}
              onChange={handleAvatarChange}
              className="hidden"
            />
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium text-black mb-3 font-ibm-plex-mono">Name</label>
          <Input
            type="text"
            placeholder="John Doe"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-full"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-black mb-3 font-ibm-plex-mono">Intro</label>
          <Textarea
            placeholder="Tell us about yourself in a few words"
            value={intro}
            onChange={(e) => setIntro(e.target.value)}
            className="w-full min-h-[100px]"
          />
        </div>
      </div>

      <div className="flex gap-3 mt-8 max-w-md">
        <Button
          onClick={handleProfileSubmit}
          disabled={!name.trim() || isLoading}
          className="flex-1 bg-[#000] text-white hover:bg-black font-ibm-plex-mono"
        >
          {isLoading ? 'Saving...' : 'Next'}
        </Button>
      </div>
    </div>
  );
}
