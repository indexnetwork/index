"use client";

import React, { useState, useCallback, useRef } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { X, Camera, Trash2, ImagePlus } from "lucide-react";
import { User } from "@/lib/types";
import { useAuth } from "@/contexts/APIContext";
import { getAvatarUrl } from "@/lib/file-utils";
import { validateFiles } from "@/lib/file-validation";
import Image from "next/image";

interface ProfileSettingsModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  user: User | null;
  onUserUpdate: (user: User) => void;
}

interface DialogComponentProps extends React.HTMLAttributes<HTMLDivElement> {
  className?: string;
  children?: React.ReactNode;
}

interface DialogTitleProps extends React.HTMLAttributes<HTMLHeadingElement> {
  className?: string;
  children?: React.ReactNode;
}

// Create simple wrapper components for dialog parts
const DialogContent = ({ className, children, ...props }: DialogComponentProps) => (
  <Dialog.Portal>
    <Dialog.Overlay className="fixed inset-0 z-50 bg-black/50" />
    <Dialog.Content
      className={`fixed left-[50%] top-[50%] z-50 w-full max-w-2xl max-h-[90vh] translate-x-[-50%] translate-y-[-50%] border border-border bg-card text-card-foreground shadow-lg dark:shadow-none duration-200 sm:rounded-lg flex flex-col ${className}`}
      {...props}
    >
      {children}
      <Dialog.Close className="absolute right-4 top-4 rounded-sm opacity-70 ring-offset-background transition-opacity hover:opacity-100">
        <X className="h-4 w-4" />
        <span className="sr-only">Close</span>
      </Dialog.Close>
    </Dialog.Content>
  </Dialog.Portal>
);

const DialogHeader = ({ className, children, ...props }: DialogComponentProps) => (
  <div className={`flex flex-col space-y-1.5 text-center sm:text-left px-6 pt-6 pb-4 border-b border-border ${className}`} {...props}>
    {children}
  </div>
);

const DialogTitle = ({ className, children, ...props }: DialogTitleProps) => (
  <Dialog.Title className={`text-lg font-semibold leading-none tracking-tight text-foreground ${className}`} {...props}>
    {children}
  </Dialog.Title>
);

export default function ProfileSettingsModal({ open, onOpenChange, user, onUserUpdate }: ProfileSettingsModalProps) {
  const [name, setName] = useState(user?.name || '');
  const [intro, setIntro] = useState(user?.intro || '');
  const [location, setLocation] = useState(user?.location || '');
  const [timezone, setTimezone] = useState(user?.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone);
  const [avatarFile, setAvatarFile] = useState<File | null>(null);
  const [avatarPreview, setAvatarPreview] = useState<string | null>(null);
  const [avatarError, setAvatarError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  // Social links state
  const [socialX, setSocialX] = useState(user?.socials?.x || '');
  const [socialLinkedin, setSocialLinkedin] = useState(user?.socials?.linkedin || '');
  const [socialGithub, setSocialGithub] = useState(user?.socials?.github || '');
  const [websites, setWebsites] = useState<string[]>(
    user?.socials?.websites || []
  );

  const fileInputRef = useRef<HTMLInputElement>(null);
  const authService = useAuth();

  const handleAvatarChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      // Validate file using shared validation logic
      const validation = validateFiles([file], 'avatar');
      if (!validation.isValid) {
        setAvatarError(validation.message || 'Invalid file');
        e.target.value = ''; // Clear the input
        return;
      }

      // Clear any previous error
      setAvatarError(null);
      setAvatarFile(file);

      // Create preview
      const reader = new FileReader();
      reader.onload = (e) => {
        setAvatarPreview(e.target?.result as string);
      };
      reader.readAsDataURL(file);
    }
  }, []);

  const addWebsite = () => {
    if (websites.length < 3) {
      setWebsites([...websites, '']);
    }
  };

  const removeWebsite = (index: number) => {
    setWebsites(websites.filter((_, i) => i !== index));
  };

  const updateWebsite = (index: number, value: string) => {
    const updated = [...websites];
    updated[index] = value;
    setWebsites(updated);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;

    setIsLoading(true);
    try {
      let avatarFilename = user.avatar;

      // Upload avatar if a new one was selected
      if (avatarFile) {
        avatarFilename = await authService.uploadAvatar(avatarFile);
      }

      // Build socials object
      const socials = {
        ...(socialX && { x: socialX }),
        ...(socialLinkedin && { linkedin: socialLinkedin }),
        ...(socialGithub && { github: socialGithub }),
        ...(websites.length > 0 && {
          websites: websites.filter(w => w)
        })
      };

      const updatedUser = await authService.updateProfile({
        name: name || undefined,
        intro: intro || undefined,
        location: location || undefined,
        avatar: avatarFilename || undefined,
        timezone: timezone || undefined,
        socials: Object.keys(socials).length > 0 ? socials : undefined,
      });

      onUserUpdate(updatedUser);
      onOpenChange(false);
    } catch (error) {
      console.error('Error updating profile:', error);
    } finally {
      setIsLoading(false);
    }
  };

  // Reset form when modal opens
  React.useEffect(() => {
    if (open && user) {
      setName(user.name);
      setIntro(user.intro || '');
      setLocation(user.location || '');
      setTimezone(user.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone);
      setAvatarFile(null);
      setAvatarPreview(null);
      setAvatarError(null);
      setSocialX(user.socials?.x || '');
      setSocialLinkedin(user.socials?.linkedin || '');
      setSocialGithub(user.socials?.github || '');
      setWebsites(user.socials?.websites || []);
    }
  }, [open, user]);

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="text-xl font-bold text-foreground font-ibm-plex-mono">
            Profile Settings
          </DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="flex flex-col flex-1 min-h-0">
          {/* Scrollable Content */}
          <div className="flex-1 overflow-y-auto px-6 py-4 space-y-6">
            {/* Avatar Section */}
            <div className="flex flex-col items-center space-y-4">
              <div className="relative">
                <div className="w-24 h-24 rounded-full overflow-hidden bg-muted border-2 border-border">
                  {avatarPreview ? (
                    <Image src={avatarPreview} alt="Avatar preview" width={96} height={96} className="w-full h-full object-cover" />
                  ) : user?.avatar ? (
                    <Image
                      src={getAvatarUrl(user)}
                      alt="Current avatar"
                      width={96}
                      height={96}
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center text-muted-foreground">
                      <Camera className="w-8 h-8" />
                    </div>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="absolute -bottom-2 -right-2 bg-card border-2 border-border rounded-full p-2 hover:bg-muted transition-colors"
                >
                  <ImagePlus className="w-4 h-4 text-muted-foreground" />
                </button>
              </div>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                onChange={handleAvatarChange}
                className="hidden"
              />
              {avatarError && (
                <p className="text-sm text-red-600 font-medium">
                  {avatarError}
                </p>
              )}
            </div>

            {/* Name Field */}
            <div>
              <label htmlFor="name" className="text-md font-medium font-ibm-plex-mono text-foreground">
                <div className="mb-2">Name *</div>
              </label>
              <Input
                id="name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="John Doe"
                required
              />
            </div>

            {/* Intro Field */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <label htmlFor="intro" className="text-md font-medium font-ibm-plex-mono text-foreground">
                  Introduction
                </label>
                <span className="text-sm text-muted-foreground">{intro.length}/500</span>
              </div>
              <Textarea
                id="intro"
                value={intro}
                onChange={(e) => setIntro(e.target.value)}
                className="min-h-[70px] resize-none [field-sizing:content]"
                placeholder="Tell others about yourself..."
                maxLength={500}
              />
            </div>

            {/* Location Field */}
            <div>
              <label htmlFor="location" className="text-md font-medium font-ibm-plex-mono text-foreground">
                <div className="mb-2">Location</div>
              </label>
              <Input
                id="location"
                value={location}
                onChange={(e) => setLocation(e.target.value)}
                placeholder="Brooklyn, NY"
              />
            </div>

            {/* Timezone Field */}
            <div>
              <label htmlFor="timezone" className="text-md font-medium font-ibm-plex-mono text-foreground">
                <div className="mb-2">Timezone</div>
              </label>
              <div className="relative">
                <select
                  id="timezone"
                  value={timezone}
                  onChange={(e) => setTimezone(e.target.value)}
                  className="flex h-10 w-full rounded-sm border border-border bg-background px-3 py-2 text-md text-foreground focus:outline-none focus:ring-2 focus:ring-accent/30 disabled:cursor-not-allowed disabled:opacity-50 appearance-none"
                >
                  {Intl.supportedValuesOf('timeZone').map((tz) => (
                    <option key={tz} value={tz}>
                      {tz.replace(/_/g, ' ')}
                    </option>
                  ))}
                </select>
                <div className="absolute right-3 top-1/2 transform -translate-y-1/2 pointer-events-none">
                  <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-muted-foreground">
                    <path d="m6 9 6 6 6-6" />
                  </svg>
                </div>
              </div>
            </div>

            {/* Social Links Section */}
            <div className="space-y-3">
              <h3 className="text-md font-medium font-ibm-plex-mono text-foreground mb-4">Socials</h3>

              {/* X (Twitter) */}
              <div className="flex items-center border border-border">
                <div className="px-3 py-2 bg-muted text-muted-foreground font-ibm-plex-mono text-sm border-r border-border whitespace-nowrap">
                  x.com/
                </div>
                <Input
                  id="socialX"
                  value={socialX}
                  onChange={(e) => setSocialX(e.target.value)}
                  className="flex-1 border-0 focus-visible:ring-0 focus-visible:ring-offset-0"
                />
              </div>

              {/* LinkedIn */}
              <div className="flex items-center border border-border">
                <div className="px-3 py-2 bg-muted text-muted-foreground font-ibm-plex-mono text-sm border-r border-border whitespace-nowrap">
                  linkedin.com/in/
                </div>
                <Input
                  id="socialLinkedin"
                  value={socialLinkedin}
                  onChange={(e) => setSocialLinkedin(e.target.value)}
                  className="flex-1 border-0 focus-visible:ring-0 focus-visible:ring-offset-0"
                />
              </div>

              {/* GitHub */}
              <div className="flex items-center border border-border">
                <div className="px-3 py-2 bg-muted text-muted-foreground font-ibm-plex-mono text-sm border-r border-border whitespace-nowrap">
                  github.com/
                </div>
                <Input
                  id="socialGithub"
                  value={socialGithub}
                  onChange={(e) => setSocialGithub(e.target.value)}
                  className="flex-1 border-0 focus-visible:ring-0 focus-visible:ring-offset-0"
                />
              </div>

              {/* Custom Websites */}
              {websites.map((website, index) => (
                <div key={index} className="flex items-center border border-border">
                  <Input
                    value={website}
                    onChange={(e) => updateWebsite(index, e.target.value)}
                    placeholder="https://example.com"
                    className="flex-1 border-0 focus-visible:ring-0 focus-visible:ring-offset-0"
                  />
                  <button
                    type="button"
                    onClick={() => removeWebsite(index)}
                    className="px-3 py-2 text-muted-foreground hover:text-red-600 dark:hover:text-red-400 transition-colors border-l border-border"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              ))}

              {/* Add Website Button */}
              {websites.length < 3 && (
                <button
                  type="button"
                  onClick={addWebsite}
                  className="w-full flex items-center justify-center px-3 py-2 border border-border text-muted-foreground hover:bg-muted transition-colors font-ibm-plex-mono text-sm"
                >
                  +
                </button>
              )}
            </div>
          </div>

          {/* Fixed Footer */}
          <div className="flex justify-end space-x-3 px-6 py-4 border-t border-border bg-card">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={isLoading}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={isLoading || !!avatarError}
            >
              {isLoading ? 'Saving...' : 'Save Changes'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog.Root>
  );
} 