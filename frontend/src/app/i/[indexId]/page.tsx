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
import { Users, Loader2, Globe } from 'lucide-react';
import { useNotifications } from '@/contexts/NotificationContext';
import { useIndexesState } from '@/contexts/IndexesContext';

interface PublicJoinPageProps {
  params: Promise<{
    indexId: string;
  }>;
}

type PageStep = 'loading' | 'auth-required' | 'ready-to-join' | 'joining' | 'error' | 'already-member';

type PageState = {
  step: PageStep;
  index: Index | null;
  user: User | null;
  error: string | null;
};

export default function PublicJoinPage({ params }: PublicJoinPageProps) {
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
        // Load public index by ID
        const index = await publicIndexesService.getPublicIndexById(resolvedParams.indexId);
        setState(prev => ({ ...prev, index }));

        // Double-check that this is a public index
        if (index.permissions?.joinPolicy !== 'anyone') {
          setState(prev => ({ 
            ...prev, 
            step: 'error', 
            error: 'This index is private. You need an invitation to join.' 
          }));
          return;
        }

        // Check authentication status
        if (!ready) {
          return; // Wait for Privy to be ready
        }

        if (!authenticated) {
          setState(prev => ({ ...prev, step: 'auth-required' }));
          return;
        }

        // User is authenticated, fetch user data
        try {
          const response = await api.get<APIResponse<User>>('/auth/me');
          if (response.user) {
            setState(prev => ({ ...prev, user: response.user || null }));

            // Join the public index immediately
            try {
              const joinResult = await indexesService.joinIndex(index.id);
              
              // Check if user is already a member
              if (joinResult?.alreadyMember) {
                setState(prev => ({ ...prev, step: 'already-member' }));
                return;
              }
              
              await refreshIndexes();
            } catch (err) {
              console.error('Failed to join index:', err);
              setState(prev => ({ 
                ...prev, 
                step: 'error', 
                error: 'Failed to join index' 
              }));
              return;
            }

            // Check if user needs onboarding
            const hasCompletedOnboarding = response.user.onboarding?.completedAt;
            if (!hasCompletedOnboarding) {
              router.push('/onboarding');
              return;
            }
            
            // User is authenticated, member, and onboarded - go to inbox
            router.push('/inbox');
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
          error: (err as Error)?.message || 'Index not found or is private' 
        }));
      }
    };

    loadIndexAndCheckAuth();
  }, [resolvedParams.indexId, authenticated, ready, api, router, indexesService, refreshIndexes]);

  // Trigger reload when user authenticates
  useEffect(() => {
    if (authenticated && ready && state.step === 'auth-required') {
      // Trigger reload to join the index
      setState(prev => ({ ...prev, step: 'loading' }));
    }
  }, [authenticated, ready, state.step]);

  const handleJoinIndex = async () => {
    if (!state.index) return;

    try {
      setState(prev => ({ ...prev, step: 'joining' }));
      
      const result = await indexesService.joinIndex(state.index.id);
      
      if (result?.alreadyMember) {
        success('You are already a member of this index');
        setState(prev => ({ ...prev, step: 'already-member' }));
      } else {
        success(`Successfully joined ${result?.index?.title || state.index.title}!`);
        // Refresh indexes context
        await refreshIndexes();
        // Redirect to the index page
        router.push(`/inbox`);
      }
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
    login();
  };

  const renderContent = () => {
    switch (state.step) {
      case 'loading':
        return (
          <div className="max-w-3xl mx-auto">
            <div className="flex flex-col items-center justify-center py-12">
              <Loader2 className="h-8 w-8 animate-spin text-gray-400 mb-4" />
              <p className="text-gray-600 font-ibm-plex-mono">Loading index...</p>
            </div>
          </div>
        );

      case 'error':
        return (
          <div className="max-w-3xl mx-auto">
            <div className="mb-6">
              <div className="w-16 h-16 bg-red-100 rounded-full flex items-center justify-center mb-4">
                <svg className="w-8 h-8 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </div>
              <h1 className="text-2xl font-bold text-black mb-2 font-ibm-plex-mono">Not Found</h1>
              <p className="text-gray-600 font-ibm-plex-mono">
                {state.error || 'This index was not found or is private.'}
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
          <div className="max-w-3xl mx-auto">
            <div className="mb-8">
              <h1 className="text-2xl font-bold text-black mb-4 font-ibm-plex-mono">
                You're about to join this network
              </h1>
              <p className="text-black text-[14px] font-ibm-plex-mono">
                Connect with others who share your intent — discover relevant matches inside this public network.
              </p>
            </div>
            
            {state.index && (
              <div className="bg-white border border-gray-200 rounded-lg p-8 mb-6">
                <div className="flex items-center gap-3 mb-4">
                  <Globe className="h-5 w-5 text-black" />
                  <h2 className="text-sm font-medium text-gray-600 font-ibm-plex-mono">
                    Public Index
                  </h2>
                </div>
                
                <h2 className="text-3xl font-bold text-black mb-6 font-ibm-plex-mono">
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
            
            <div className="max-w-md">
              <Button
                onClick={handleLogin}
                className="bg-black text-white hover:bg-gray-800 font-ibm-plex-mono"
              >
                Sign in to join
              </Button>
            </div>
          </div>
        );

      case 'ready-to-join':
        return (
          <div className="max-w-3xl mx-auto">
            <div className="mb-8">
              <h1 className="text-2xl font-bold text-black mb-4 font-ibm-plex-mono">
                You're about to join this network
              </h1>
              <p className="text-black text-[14px] font-ibm-plex-mono">
                Connect with others who share your intent — discover relevant matches inside this public network.
              </p>
            </div>
            
            {state.index && (
              <div className="bg-white border border-gray-200 rounded-lg p-8 mb-6">
                <div className="flex items-center gap-3 mb-4">
                  <Globe className="h-5 w-5 text-black" />
                  <h2 className="text-sm font-medium text-gray-600 font-ibm-plex-mono">
                    Public Index
                  </h2>
                </div>
                
                <h2 className="text-3xl font-bold text-black mb-6 font-ibm-plex-mono">
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
            
            <div className="max-w-md">
              <Button
                onClick={handleJoinIndex}
                className="w-full bg-black text-white hover:bg-gray-800 font-ibm-plex-mono"
              >
                Join
              </Button>
            </div>
          </div>
        );

      case 'joining':
        return (
          <div className="max-w-3xl mx-auto">
            <div className="flex flex-col items-center justify-center py-12">
              <Loader2 className="h-8 w-8 animate-spin text-blue-600 mb-4" />
              <p className="text-gray-600 font-ibm-plex-mono">Joining index...</p>
            </div>
          </div>
        );

      case 'already-member':
        return (
          <div className="max-w-3xl mx-auto">
            <div className="mb-6">
              <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mb-4">
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
      <div className="bg-[#FAFAFA]">
        <div className="px-6 py-12">
          {renderContent()}
        </div>
      </div>
    </ClientLayout>
  );
}

