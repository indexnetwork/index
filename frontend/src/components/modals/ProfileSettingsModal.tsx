"use client";

import React, { useState, useCallback, useRef } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { X, Upload, Camera } from "lucide-react";
import { User, AvatarUploadResponse, APIResponse, UpdateProfileRequest } from "@/lib/types";
import { useAuthenticatedAPI } from "@/lib/api";
import { getAvatarUrl } from "@/lib/file-utils";
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

interface DialogDescriptionProps extends React.HTMLAttributes<HTMLParagraphElement> {
  className?: string;
  children?: React.ReactNode;
}

// Create simple wrapper components for dialog parts
const DialogContent = ({ className, children, ...props }: DialogComponentProps) => (
  <Dialog.Portal>
    <Dialog.Overlay className="fixed inset-0 z-50 bg-black/50" />
    <Dialog.Content
      className={`fixed left-[50%] top-[50%] z-50 grid w-full max-w-2xl translate-x-[-50%] translate-y-[-50%] gap-4 border bg-white p-6 shadow-lg duration-200 sm:rounded-lg ${className}`}
      {...props}
    >
      {children}
      <Dialog.Close className="absolute right-4 top-4 rounded-sm opacity-70 ring-offset-white transition-opacity hover:opacity-100">
        <X className="h-4 w-4" />
        <span className="sr-only">Close</span>
      </Dialog.Close>
    </Dialog.Content>
  </Dialog.Portal>
);

const DialogHeader = ({ className, children, ...props }: DialogComponentProps) => (
  <div className={`flex flex-col space-y-1.5 text-center sm:text-left ${className}`} {...props}>
    {children}
  </div>
);

const DialogTitle = ({ className, children, ...props }: DialogTitleProps) => (
  <Dialog.Title className={`text-lg font-semibold leading-none tracking-tight ${className}`} {...props}>
    {children}
  </Dialog.Title>
);

const DialogDescription = ({ className, children, ...props }: DialogDescriptionProps) => (
  <Dialog.Description className={`text-sm text-gray-500 ${className}`} {...props}>
    {children}
  </Dialog.Description>
);

export default function ProfileSettingsModal({ open, onOpenChange, user, onUserUpdate }: ProfileSettingsModalProps) {
  const [name, setName] = useState(user?.name || '');
  const [intro, setIntro] = useState(user?.intro || '');
  const [avatarFile, setAvatarFile] = useState<File | null>(null);
  const [avatarPreview, setAvatarPreview] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const api = useAuthenticatedAPI();

  const handleAvatarChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setAvatarFile(file);
      
      // Create preview
      const reader = new FileReader();
      reader.onload = (e) => {
        setAvatarPreview(e.target?.result as string);
      };
      reader.readAsDataURL(file);
    }
  }, []);

  const uploadAvatar = async (file: File): Promise<string> => {
    // Use the uploadFile method with 'avatar' as the field name
    const result = await api.uploadFile<AvatarUploadResponse>('/upload/avatar', file, undefined, 'avatar');
    return result.avatarFilename;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;
    
    setIsLoading(true);
    try {
      let avatarFilename = user.avatar;
      
      // Upload avatar if a new one was selected
      if (avatarFile) {
        avatarFilename = await uploadAvatar(avatarFile);
      }
      
      const response = await api.patch<APIResponse<User>>('/auth/profile', {
        name: name || undefined,
        intro: intro || undefined,
        avatar: avatarFilename || undefined,
      });
      
      if (!response.user) {
        throw new Error('Failed to update profile');
      }
      
      const updatedUser = response.user;
      
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
      setAvatarFile(null);
      setAvatarPreview(null);
    }
  }, [open, user]);

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="text-xl font-bold text-gray-900 font-ibm-plex-mono">Profile Settings</DialogTitle>
          <DialogDescription>
            Update your profile information and avatar.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-6">
          {/* Avatar Section */}
          <div className="flex flex-col items-center space-y-4">
            <div className="relative">
                             <div className="w-24 h-24 rounded-full overflow-hidden bg-gray-200 border-2 border-gray-300">
                 {avatarPreview ? (
                   <Image src={avatarPreview} alt="Avatar preview" width={96} height={96} className="w-full h-full object-cover" />
                 ) : user?.avatar ? (
                   <Image 
                     src={getAvatarUrl(user.avatar)} 
                     alt="Current avatar" 
                     width={96} 
                     height={96} 
                     className="w-full h-full object-cover" 
                   />
                 ) : (
                   <div className="w-full h-full flex items-center justify-center text-gray-400">
                     <Camera className="w-8 h-8" />
                   </div>
                 )}
               </div>
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="absolute -bottom-2 -right-2 bg-white border-2 border-gray-300 rounded-full p-2 hover:bg-gray-50 transition-colors"
              >
                <Upload className="w-4 h-4 text-gray-600" />
              </button>
            </div>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              onChange={handleAvatarChange}
              className="hidden"
            />
            <p className="text-sm text-gray-500">Click the upload button to change your avatar</p>
          </div>

          {/* Name Field */}
          <div>
            <label htmlFor="name" className="text-md font-medium font-ibm-plex-mono text-black">
              <div className="mb-2">Name *</div>
            </label>
            <Input
              id="name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="px-4 py-3"
              placeholder="Enter your name..."
              required
            />
          </div>

          {/* Email Field (Read-only) */}
          <div>
            <label htmlFor="email" className="text-md font-medium font-ibm-plex-mono text-black">
              <div className="mb-2">Email</div>
            </label>
            <Input
              id="email"
              value={user?.email || 'Not provided'}
              className="px-4 py-3 bg-gray-50"
              disabled
            />
            <p className="text-sm text-gray-500 mt-1">Email is managed by your authentication provider</p>
          </div>

          {/* Intro Field */}
          <div>
            <label htmlFor="intro" className="text-md font-medium font-ibm-plex-mono text-black">
              <div className="mb-2">Introduction</div>
            </label>
            <Textarea
              id="intro"
              value={intro}
              onChange={(e) => setIntro(e.target.value)}
              className="px-4 py-3 min-h-[100px]"
              placeholder="Tell others about yourself..."
              maxLength={500}
            />
            <p className="text-sm text-gray-500 mt-1">{intro.length}/500 characters</p>
          </div>

          <div className="flex justify-end space-x-3">
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
              disabled={isLoading}
            >
              {isLoading ? 'Saving...' : 'Save Changes'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog.Root>
  );
} 