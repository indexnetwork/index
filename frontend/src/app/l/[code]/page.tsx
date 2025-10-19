"use client";

import { useState, useEffect, use } from "react";
import { Button } from "@/components/ui/button";
import { Index, User, APIResponse } from "@/lib/types";
import ClientLayout from "@/components/ClientLayout";
import { usePrivy } from '@privy-io/react-auth';
import { useIndexes } from '@/contexts/APIContext';
import { indexesService as publicIndexesService } from '@/services/indexes';
import { useAuthenticatedAPI } from '@/lib/api';
import { useRouter } from 'next/navigation';
import { Lock, Users, Loader2 } from 'lucide-react';
import { useNotifications } from '@/contexts/NotificationContext';
import { useIndexesState } from '@/contexts/IndexesContext';

interface InvitationPageProps {
  params: Promise<{
    code: string;
  }>;
}

type PageStep = 'loading' | 'auth-required' | 'onboarding-required' | 'ready-to-join' | 'joining' | 'error' | 'already-member';

type PageState = {
  step: PageStep;
  index: Index | null;
  user: User | null;
  error: string | null;
};

export default function InvitationPage({ params }: InvitationPageProps) {
  const resolvedParams = use(params);
  const [state, setState] = useState<PageState>({
    step: 'loading',
    index: null,
    user: null,
    error: null,
  });

  const { login, authenticated, ready } = usePrivy();
  const api = useAuthenticatedAPI();
  const indexesService = useIndexes();
  const router = useRouter();
  const { success, error: notifyError } = useNotifications();
  const { refreshIndexes } = useIndexesState();

  // Load index and check user state
  useEffect(() => {
    const loadIndexAndCheckAuth = async () => {
      try {
        // Load index by share code
        const index = await publicIndexesService.getIndexByShareCode(resolvedParams.code);
        setState(prev => ({ ...prev, index }));

        // Check authentication status
        if (!ready) {
          return; // Wait for Privy to be ready
        }

        if (!authenticated) {
          // Store code for post-auth redirect
          localStorage.setItem('invitation_code', resolvedParams.code);
          setState(prev => ({ ...prev, step: 'auth-required' }));
          return;
        }

        // User is authenticated, fetch user data
        try {
          const response = await api.get<APIResponse<User>>('/auth/me');
          if (response.user) {
            setState(prev => ({ ...prev, user: response.user || null }));

            // Check if user needs onboarding
            if (!response.user.intro || response.user.intro.trim() === '') {
              // Store code for post-onboarding redirect
              localStorage.setItem('invitation_code', resolvedParams.code);
              router.push('/onboarding');
              return;
            }

            // Check if user is already a member
            try {
              await indexesService.getIndex(index.id);
              // If we can access the index, user is already a member
              setState(prev => ({ ...prev, step: 'already-member' }));
            } catch {
              // User is not a member, show join UI
              setState(prev => ({ ...prev, step: 'ready-to-join' }));
            }
          }
        } catch (err) {
          console.error('Failed to fetch user:', err);
          setState(prev => ({ 
            ...prev, 
            step: 'error', 
            error: 'Failed to load user data' 
          }));
        }
      } catch (err) {
        console.error('Failed to load index:', err);
        setState(prev => ({ 
          ...prev, 
          step: 'error', 
          error: (err as Error)?.message || 'Invalid or expired invitation link' 
        }));
      }
    };

    loadIndexAndCheckAuth();
  }, [resolvedParams.code, authenticated, ready, api, router, indexesService]);

  // Check for stored invitation code after login
  useEffect(() => {
    if (authenticated && ready) {
      const storedCode = localStorage.getItem('invitation_code');
      if (storedCode === resolvedParams.code) {
        // Clear the stored code
        localStorage.removeItem('invitation_code');
        // Trigger reload to check membership
        setState(prev => ({ ...prev, step: 'loading' }));
      }
    }
  }, [authenticated, ready, resolvedParams.code]);

  const handleJoinIndex = async () => {
    if (!state.index) return;

    try {
      setState(prev => ({ ...prev, step: 'joining' }));
      
      const result = await indexesService.acceptInvitation(resolvedParams.code);
      
      if (result.alreadyMember) {
        success('You are already a member of this index');
      } else {
        success(`Successfully joined ${result.index.title}!`);
      }
      
      // Refresh indexes context
      await refreshIndexes();
      
      // Redirect to the index page
      router.push(`/inbox?index=${result.index.id}`);
    } catch (err) {
      console.error('Failed to join index:', err);
      notifyError((err as Error)?.message || 'Failed to join index');
      setState(prev => ({ 
        ...prev, 
        step: 'error', 
        error: (err as Error)?.message || 'Failed to join index' 
      }));
    }
  };

  const handleLogin = () => {
    // Store code for post-auth redirect
    localStorage.setItem('invitation_code', resolvedParams.code);
    login();
  };

  const renderContent = () => {
    switch (state.step) {
      case 'loading':
        return (
          <div className="flex flex-col items-center justify-center py-12">
            <Loader2 className="h-8 w-8 animate-spin text-gray-400 mb-4" />
            <p className="text-gray-600 font-ibm-plex-mono">Loading invitation...</p>
          </div>
        );

      case 'error':
        return (
          <div className="max-w-md mx-auto text-center py-12">
            <div className="mb-6">
              <div className="w-16 h-16 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-4">
                <svg className="w-8 h-8 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </div>
              <h1 className="text-2xl font-bold text-black mb-2 font-ibm-plex-mono">Invalid Invitation</h1>
              <p className="text-gray-600 font-ibm-plex-mono">
                {state.error || 'This invitation link is invalid or has expired.'}
              </p>
            </div>
            <Button
              onClick={() => router.push('/')}
              className="bg-black text-white hover:bg-gray-800 font-ibm-plex-mono"
            >
              Go to Homepage
            </Button>
          </div>
        );

      case 'auth-required':
        return (
          <div className="max-w-lg mx-auto">
            {state.index && (
              <div className="bg-white border border-gray-200 rounded-lg p-8 mb-6">
                <div className="flex items-center gap-3 mb-4">
                  <Lock className="h-5 w-5 text-blue-600" />
                  <h2 className="text-sm font-medium text-gray-600 font-ibm-plex-mono">Private Index</h2>
                </div>
                
                <h1 className="text-2xl font-bold text-black mb-3 font-ibm-plex-mono">
                  You've been invited to join
                </h1>
                <h2 className="text-3xl font-bold text-black mb-4 font-ibm-plex-mono">
                  {state.index.title}
                </h2>
                
                {state.index._count && (
                  <div className="flex items-center gap-2 text-gray-600">
                    <Users className="h-4 w-4" />
                    <span className="text-sm font-ibm-plex-mono">
                      {state.index._count.members} {state.index._count.members === 1 ? 'member' : 'members'}
                    </span>
                  </div>
                )}
              </div>
            )}
            
            <Button
              onClick={handleLogin}
              className="w-full bg-black text-white hover:bg-gray-800 font-ibm-plex-mono"
            >
              Sign in to accept invitation
            </Button>
          </div>
        );

      case 'ready-to-join':
        return (
          <div className="max-w-lg mx-auto">
            {state.index && (
              <div className="bg-white border border-gray-200 rounded-lg p-8 mb-6">
                <div className="flex items-center gap-3 mb-4">
                  <Lock className="h-5 w-5 text-blue-600" />
                  <h2 className="text-sm font-medium text-gray-600 font-ibm-plex-mono">Private Index</h2>
                </div>
                
                <h1 className="text-2xl font-bold text-black mb-3 font-ibm-plex-mono">
                  Join
                </h1>
                <h2 className="text-3xl font-bold text-black mb-4 font-ibm-plex-mono">
                  {state.index.title}
                </h2>
                
                {state.index.prompt && (
                  <p className="text-gray-700 mb-4 font-ibm-plex-mono text-sm">
                    {state.index.prompt}
                  </p>
                )}
                
                {state.index._count && (
                  <div className="flex items-center gap-2 text-gray-600">
                    <Users className="h-4 w-4" />
                    <span className="text-sm font-ibm-plex-mono">
                      {state.index._count.members} {state.index._count.members === 1 ? 'member' : 'members'}
                    </span>
                  </div>
                )}
              </div>
            )}
            
            <Button
              onClick={handleJoinIndex}
              className="w-full bg-blue-600 text-white hover:bg-blue-700 font-ibm-plex-mono"
            >
              Accept Invitation & Join
            </Button>
          </div>
        );

      case 'joining':
        return (
          <div className="flex flex-col items-center justify-center py-12">
            <Loader2 className="h-8 w-8 animate-spin text-blue-600 mb-4" />
            <p className="text-gray-600 font-ibm-plex-mono">Joining index...</p>
          </div>
        );

      case 'already-member':
        return (
          <div className="max-w-md mx-auto text-center py-12">
            <div className="mb-6">
              <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
                <svg className="w-8 h-8 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
              </div>
              <h1 className="text-2xl font-bold text-black mb-2 font-ibm-plex-mono">Already a Member</h1>
              <p className="text-gray-600 font-ibm-plex-mono mb-4">
                You're already a member of {state.index?.title}.
              </p>
            </div>
            <Button
              onClick={() => router.push(`/inbox`)}
              className="bg-black text-white hover:bg-gray-800 font-ibm-plex-mono"
            >
              Go to your Inbox
            </Button>
          </div>
        );

      default:
        return null;
    }
  };

  return (
    <ClientLayout>
      <div className="min-h-screen bg-[#FAFAFA] py-12 px-6">
        {renderContent()}
      </div>
    </ClientLayout>
  );
}

