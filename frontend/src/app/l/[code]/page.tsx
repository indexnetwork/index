import { useState, useEffect } from "react";
import { useNavigate, useParams } from "react-router";
import { Button } from "@/components/ui/button";
import { Network, User, APIResponse } from "@/lib/types";
import ClientLayout from "@/components/ClientLayout";
import { ContentContainer } from "@/components/layout";
import { useNetworks } from '@/contexts/APIContext';
import { networksService as publicIndexesService } from '@/services/networks';
import { useAuthenticatedAPI } from '@/lib/api';
import { Lock, Users, Loader2 } from 'lucide-react';
import { useNotifications } from '@/contexts/NotificationContext';
import { useNetworksState } from '@/contexts/NetworksContext';
import { useAuthContext } from '@/contexts/AuthContext';

type PageStep = 'loading' | 'auth-required' | 'onboarding-required' | 'ready-to-join' | 'joining' | 'error' | 'already-member';

type PageState = {
  step: PageStep;
  index: Network | null;
  user: User | null;
  error: string | null;
};

export default function InvitationPage() {
  const { code } = useParams();
  const [state, setState] = useState<PageState>({
    step: 'loading',
    index: null,
    user: null,
    error: null,
  });

  const { isAuthenticated, isReady, openLoginModal } = useAuthContext();
  const api = useAuthenticatedAPI();
  const networksService = useNetworks();
  const navigate = useNavigate();
  const { success, error: notifyError } = useNotifications();
  const { refreshNetworks } = useNetworksState();
  const { refetchUser } = useAuthContext();

  // Load index and check user state
  useEffect(() => {
    const loadIndexAndCheckAuth = async () => {
      try {
        // Load index by share code (works for both invitation codes and index IDs)
        const index = await publicIndexesService.getNetworkByShareCode(code!);
        setState(prev => ({ ...prev, index }));

        // Reject public networks - they should use /network/[networkId] instead
        if (index.permissions?.joinPolicy === 'anyone') {
          setState(prev => ({ 
            ...prev, 
            step: 'error', 
            error: 'No invitation found' 
          }));
          return;
        }

        // Check authentication status
        if (!isReady) {
          return; // Wait for auth to be ready
        }

        if (!isAuthenticated) {
          // Persist the code so onboarding can pick it up after sign-up
          localStorage.setItem('pendingInviteCode', code!);
          setState(prev => ({ ...prev, step: 'auth-required' }));
          return;
        }

        // User is authenticated - check whether they've completed onboarding
        try {
          const response = await api.get<APIResponse<User>>('/auth/me');
          if (response.user) {
            if (!response.user.onboarding?.completedAt) {
              // Deferred join: code is in localStorage, redirect to onboarding
              localStorage.setItem('pendingInviteCode', code!);
              navigate('/onboarding');
              return;
            }
            // Clean up deferred invite code since user will join explicitly via button
            localStorage.removeItem('pendingInviteCode');
            setState(prev => ({ ...prev, user: response.user || null, step: 'ready-to-join' }));
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
  }, [code, isAuthenticated, isReady, api, navigate]);

  // Trigger reload when user authenticates
  useEffect(() => {
    if (isAuthenticated && isReady && state.step === 'auth-required') {
      // Trigger reload to check membership
      setState(prev => ({ ...prev, step: 'loading' }));
    }
  }, [isAuthenticated, isReady, state.step]);

  const handleJoinIndex = async () => {
    if (!state.index) return;

    try {
      setState(prev => ({ ...prev, step: 'joining' }));
      
      // Accept private invitation
      const result = await networksService.acceptInvitation(code!);
      
      if (result?.alreadyMember) {
        success('You are already a member of this index');
        setState(prev => ({ ...prev, step: 'already-member' }));
      } else {
        success(`Successfully joined ${result?.network?.title || state.index.title}!`);
        // Refresh indexes context
        await refreshNetworks();
        // Redirect to the index page
        navigate(`/`);
      }
    } catch (err) {
      console.error('Failed to accept invitation:', err);
      notifyError((err as Error)?.message || 'Failed to accept invitation');
      setState(prev => ({ 
        ...prev, 
        step: 'error', 
        error: (err as Error)?.message || 'Failed to accept invitation' 
      }));
    }
  };

  const handleLogin = () => {
    openLoginModal();
  };

  const renderContent = () => {
    switch (state.step) {
      case 'loading':
        return (
          <ContentContainer>
            <div className="flex flex-col items-center justify-center py-12">
              <Loader2 className="h-8 w-8 animate-spin text-gray-400 mb-4" />
              <p className="text-gray-600 font-ibm-plex-mono">Loading invitation...</p>
            </div>
          </ContentContainer>
        );

      case 'error':
        return (
          <ContentContainer>
            <div className="mb-6">
              <div className="w-16 h-16 bg-red-100 rounded-full flex items-center justify-center mb-4">
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
              onClick={() => navigate('/')}
              className="bg-[#041729] text-white hover:bg-[#0a2d4a] font-ibm-plex-mono"
            >
              Go to Homepage
            </Button>
          </ContentContainer>
        );

      case 'auth-required':
        return (
          <ContentContainer>
            <div className="mb-8">
              <h1 className="text-2xl font-bold text-black mb-4 font-ibm-plex-mono">
                You're invited to join
              </h1>
              <p className="text-black text-[14px] font-ibm-plex-mono">
                Connect with others who share your intent — discover relevant matches inside this private network.
              </p>
            </div>
            
            {state.index && (
              <div className="bg-white border border-gray-200 rounded-lg p-8 mb-6">
                <div className="flex items-center gap-3 mb-4">
                  <Lock className="h-5 w-5 text-black" />
                  <h2 className="text-sm font-medium text-gray-600 font-ibm-plex-mono">
                    Private Network
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
                className=" bg-[#041729] text-white hover:bg-[#0a2d4a] font-ibm-plex-mono"
              >
                Sign in to accept invitation
              </Button>
            </div>
          </ContentContainer>
        );

      case 'ready-to-join':
        return (
          <ContentContainer>
            <div className="mb-8">
              <h1 className="text-2xl font-bold text-black mb-4 font-ibm-plex-mono">
                You're invited to join
              </h1>
              <p className="text-black text-[14px] font-ibm-plex-mono">
                Connect with others who share your intent — discover relevant matches inside this private network.
              </p>
            </div>
            
            {state.index && (
              <div className="bg-white border border-gray-200 rounded-lg p-8 mb-6">
                <div className="flex items-center gap-3 mb-4">
                  <Lock className="h-5 w-5 text-black" />
                  <h2 className="text-sm font-medium text-gray-600 font-ibm-plex-mono">
                    Private Network
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
                className="w-full bg-[#041729] text-white hover:bg-[#0a2d4a] font-ibm-plex-mono"
              >
                Accept invitation & join
              </Button>
            </div>
          </ContentContainer>
        );

      case 'joining':
        return (
          <ContentContainer>
            <div className="flex flex-col items-center justify-center py-12">
              <Loader2 className="h-8 w-8 animate-spin text-blue-600 mb-4" />
              <p className="text-gray-600 font-ibm-plex-mono">Joining index...</p>
            </div>
          </ContentContainer>
        );

      case 'already-member':
        return (
          <ContentContainer>
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
              onClick={() => navigate(`/`)}
              className="bg-[#041729] text-white hover:bg-[#0a2d4a] font-ibm-plex-mono"
            >
              Go to your Inbox
            </Button>
          </ContentContainer>
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


export const Component = InvitationPage;
