"use client";

import React, { useState, useRef, useEffect, ChangeEvent, useId } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import Image from "next/image";
import { getAvatarUrl } from "@/lib/file-utils";
import { useNotifications } from "@/contexts/NotificationContext";
import type { UpdateProfileRequest } from "@/services/auth";
import { useAuthContext } from "@/contexts/AuthContext";
import { useAuth as useAuthService } from "@/contexts/APIContext";
import { getSupportedFileExtensions, validateFiles } from "@/lib/file-validation";
import { OnboardingStep } from "@/lib/onboardingTypes";
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

  const nameInputId = useId();
  const introInputId = useId();

  // Profile step states
  const [name, setName] = useState('');
  const [location, setLocation] = useState('');
  const [intro, setIntro] = useState('');
  const [avatarFile, setAvatarFile] = useState<File | null>(null);
  const [avatarPreview, setAvatarPreview] = useState<string | null>(null);
  const [profileInitialized, setProfileInitialized] = useState(false);
  const lastSyncedUserRef = useRef<{
    id: string | null;
    name: string;
    intro: string;
    location: string;
    socialX: string;
    socialLinkedin: string;
    socialGithub: string;
    websites: Array<{ label: string; url: string }>;
  } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

   // Social links state
  const [socialX, setSocialX] = useState('');
  const [socialLinkedin, setSocialLinkedin] = useState('');
  const [socialGithub, setSocialGithub] = useState('');
  const [websites, setWebsites] = useState<Array<{ label: string; url: string }>>([]);

  // Initialize form fields when user data is available
  useEffect(() => {
    if (!user) {
      setName("");
      setIntro("");
      setLocation("");
      setSocialX("");
      setSocialLinkedin("");
      setSocialGithub("");
      setWebsites([]);
      lastSyncedUserRef.current = null;
      setProfileInitialized(false);
      return;
    }

    const normalizedName = user.name ?? "";
    const normalizedIntro = user.intro ?? "";
    const snapshot = lastSyncedUserRef.current;
    const normalizedId = user.id ?? null;
    const normalizedLocation = user.location ?? '';
    const normalizedSocialX = user.socials?.x ?? '';
    const normalizedSocialLinkedin = user.socials?.linkedin ?? '';
    const normalizedSocialGithub = user.socials?.github ?? '';
    const normalizedWebsites =
      (user.socials?.websites ?? []).map((w) => ({
        label: w?.label ?? '',
        url: w?.url ?? '',
      }));
    const shouldSyncProfile =
    !profileInitialized ||
    !snapshot ||
      snapshot.id !== normalizedId ||
      snapshot.name !== normalizedName ||
      snapshot.intro !== normalizedIntro ||
      snapshot.location !== normalizedLocation ||
      snapshot.socialX !== normalizedSocialX ||
      snapshot.socialLinkedin !== normalizedSocialLinkedin ||
      snapshot.socialGithub !== normalizedSocialGithub ||
      JSON.stringify(snapshot.websites) !== JSON.stringify(normalizedWebsites);
    
    if (shouldSyncProfile) {
      setLocation(normalizedLocation);
      setName(normalizedName);
      setIntro(normalizedIntro);
      setSocialX(normalizedSocialX);
      setSocialLinkedin(normalizedSocialLinkedin);
      setSocialGithub(normalizedSocialGithub);
      setWebsites(normalizedWebsites);
      lastSyncedUserRef.current = {
        id: normalizedId,
        name: normalizedName,
        intro: normalizedIntro,
        location: normalizedLocation,
        socialX: normalizedSocialX,
        socialLinkedin: normalizedSocialLinkedin,
        socialGithub: normalizedSocialGithub,
        websites: normalizedWebsites,
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
      const socialWebsites = websites
        .map((website) => ({
          label: website.label?.trim() || '',
          url: website.url.trim(),
        }))
        .filter((website) => website.url);

      const socialsPayload: NonNullable<UpdateProfileRequest["socials"]> = {};

      if (socialX.trim()) {
        socialsPayload.x = socialX.trim();
      }

      if (socialLinkedin.trim()) {
        socialsPayload.linkedin = socialLinkedin.trim();
      }

      if (socialGithub.trim()) {
        socialsPayload.github = socialGithub.trim();
      }

      if (socialWebsites.length > 0) {
        socialsPayload.websites = socialWebsites;
      }

      const profilePayload: UpdateProfileRequest = {
        name: name.trim(),
        intro: intro.trim(),
      };

      if (location.trim()) {
        profilePayload.location = location.trim();
      }

      if (avatarFile) {
        const avatarFilename = await uploadAvatar(avatarFile);
        if (avatarFilename) {
          profilePayload.avatar = avatarFilename;
        }
      }

      if (Object.keys(socialsPayload).length > 0) {
        profilePayload.socials = socialsPayload;
      }

      const updatedUser = await authService.updateProfile(profilePayload);
          
        
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
              aria-label="Avatar upload"
              className="hidden"
            />
          </div>
        </div>

        <div>
          <label htmlFor={nameInputId} className="block text-sm font-medium text-black mb-3 font-ibm-plex-mono">Name</label>
          <Input
            id={nameInputId}
            type="text"
            placeholder="John Doe"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-full"
          />
        </div>


        <div>
          <label htmlFor={introInputId} className="block text-sm font-medium text-black mb-3 font-ibm-plex-mono">Intro</label>
          <Textarea
            id={introInputId}
            placeholder="Tell us about yourself in a few words"
            value={intro}
            onChange={(e) => setIntro(e.target.value)}
            className="w-full min-h-[100px]"
          />
        </div>
        
        <div>
          <label className="block text-sm font-medium text-black mb-3 font-ibm-plex-mono">Location</label>
          <Input
            type="text"
            placeholder="San Francisco, CA"
            value={location}
            onChange={(e) => setLocation(e.target.value)}
            className="w-full"
          />
        </div>
      </div>

      {/* Social Links Section */}
      <div className="space-y-3 pt-2">
        <h3 className="text-sm font-medium text-black font-ibm-plex-mono mb-3">Socials</h3>
        
        {/* X (Twitter) */}
        <div className="flex items-center border border-gray-300">
          <div className="px-3 py-2 bg-gray-50 text-gray-600 font-ibm-plex-mono text-sm border-r border-gray-300 whitespace-nowrap">
            x.com/
          </div>
          <Input
            type="text"
            value={socialX}
            onChange={(e) => setSocialX(e.target.value)}
            className="flex-1 border-0 focus-visible:ring-0 focus-visible:ring-offset-0"
          />
        </div>

        {/* LinkedIn */}
        <div className="flex items-center border border-gray-300">
          <div className="px-3 py-2 bg-gray-50 text-gray-600 font-ibm-plex-mono text-sm border-r border-gray-300 whitespace-nowrap">
            linkedin.com/in/
          </div>
          <Input
            type="text"
            value={socialLinkedin}
            onChange={(e) => setSocialLinkedin(e.target.value)}
            className="flex-1 border-0 focus-visible:ring-0 focus-visible:ring-offset-0"
          />
        </div>

        {/* GitHub */}
        <div className="flex items-center border border-gray-300">
          <div className="px-3 py-2 bg-gray-50 text-gray-600 font-ibm-plex-mono text-sm border-r border-gray-300 whitespace-nowrap">
            github.com/
          </div>
          <Input
            type="text"
            value={socialGithub}
            onChange={(e) => setSocialGithub(e.target.value)}
            className="flex-1 border-0 focus-visible:ring-0 focus-visible:ring-offset-0"
          />
        </div>

        {/* Custom Websites */}
        {websites.map((website, index) => (
          <div key={index} className="flex items-center border border-gray-300">
            <Input
              value={website.url}
              onChange={(e) => {
                const updated = [...websites];
                updated[index].url = e.target.value;
                setWebsites(updated);
              }}
              placeholder="https://example.com"
              className="flex-1 border-0 focus-visible:ring-0 focus-visible:ring-offset-0"
            />
            <button
              type="button"
              onClick={() => setWebsites(websites.filter((_, i) => i !== index))}
              className="px-3 py-2 text-gray-500 hover:text-red-600 transition-colors border-l border-gray-300"
            >
              ×
            </button>
          </div>
        ))}

        {/* Add Website Button */}
        {websites.length < 3 && (
          <button
            type="button"
            onClick={() => setWebsites([...websites, { label: '', url: '' }])}
            className="w-full flex items-center justify-center px-3 py-2 border border-gray-300 text-gray-600 hover:bg-gray-50 transition-colors font-ibm-plex-mono text-sm"
          >
            +
          </button>
        )}
      </div>

      <div className="flex gap-3 mt-8 max-w-md">
        <Button
          onClick={handleProfileSubmit}
          disabled={!name.trim() || isLoading}
          className="flex-1 bg-black text-white hover:bg-black font-ibm-plex-mono"
        >
          {isLoading ? 'Saving...' : 'Next'}
        </Button>
      </div>
    </div>
  );
}
