import { useState, useEffect } from "react";
import { useNavigate, useParams } from "react-router";
import { Button } from "@/components/ui/button";
import { Network, User, APIResponse } from "@/lib/types";
import ClientLayout from "@/components/ClientLayout";
import { ContentContainer } from "@/components/layout";
import { useNetworks } from '@/contexts/APIContext';
import { networksService as publicNetworksService } from '@/services/networks';
import { useAuthenticatedAPI } from '@/lib/api';
import { Users, Loader2, Globe } from 'lucide-react';
import { useNotifications } from '@/contexts/NotificationContext';
import { useNetworksState } from '@/contexts/NetworksContext';
import { useAuthContext } from '@/contexts/AuthContext';

type PageStep = 'loading' | 'auth-required' | 'ready-to-join' | 'joining' | 'error' | 'already-member';

type PageState = {
  step: PageStep;
  network: Network | null;
  user: User | null;
  error: string | null;
};

export default function PublicJoinPage() {
  const { networkId } = useParams();
  const [state, setState] = useState<PageState>({
    step: 'loading',
    network: null,
    user: null,
    error: null,
  });

  const { isAuthenticated, isReady, openLoginModal } = useAuthContext();
  const api = useAuthenticatedAPI();
  const networksService = useNetworks();
  const navigate = useNavigate();
  const { success, error: notifyError } = useNotifications();
  const { refreshNetworks } = useNetworksState();

  // Load index and check user state
  useEffect(() => {
    const loadIndexAndCheckAuth = async () => {
      try {
        // Load public index by ID
        const network = await publicNetworksService.getPublicNetworkById(networkId!);
        setState(prev => ({ ...prev, network }));

        // Double-check that this is a public index
        if (network.permissions?.joinPolicy !== 'anyone') {
          setState(prev => ({ 
            ...prev, 
            step: 'error', 
            error: 'This network is private. You need an invitation to join.' 
          }));
          return;
        }

        // Check authentication status
        if (!isReady) {
          return; // Wait for auth to be ready
        }

        if (!isAuthenticated) {
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
              const joinResult = await networksService.joinNetwork(network.id);
              
              // Check if user is already a member
              if (joinResult?.alreadyMember) {
                setState(prev => ({ ...prev, step: 'already-member' }));
                return;
              }
              
              await refreshNetworks();
            } catch (err) {
              console.error('Failed to join network:', err);
              setState(prev => ({ 
                ...prev, 
                step: 'error', 
                error: 'Failed to join network' 
              }));
              return;
            }

            // User is authenticated and member - go to root
            navigate('/');
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
        console.error('Failed to load network:', err);
        setState(prev => ({ 
          ...prev, 
          step: 'error', 
          error: (err as Error)?.message || 'Network not found or is private' 
        }));
      }
    };

    loadIndexAndCheckAuth();
  }, [networkId, isAuthenticated, isReady, api, navigate, networksService, refreshNetworks]);

  // Trigger reload when user authenticates
  useEffect(() => {
    if (isAuthenticated && isReady && state.step === 'auth-required') {
      // Trigger reload to join the index
      setState(prev => ({ ...prev, step: 'loading' }));
    }
  }, [isAuthenticated, isReady, state.step]);

  const handleJoinNetwork = async () => {
    if (!state.network) return;

    try {
      setState(prev => ({ ...prev, step: 'joining' }));
      
      const result = await networksService.joinNetwork(state.network.id);
      
      if (result?.alreadyMember) {
        success('You are already a member of this network');
        setState(prev => ({ ...prev, step: 'already-member' }));
      } else {
        success(`Successfully joined ${result?.network?.title || state.network.title}!`);
        // Refresh networks context
        await refreshNetworks();
        // Redirect to root
        navigate(`/`);
      }
    } catch (err) {
      console.error('Failed to join network:', err);
      notifyError((err as Error)?.message || 'Failed to join network');
      setState(prev => ({ 
        ...prev, 
        step: 'error', 
        error: (err as Error)?.message || 'Failed to join network' 
      }));
    }
  };

  const handleLogin = () => {
    // Store index ID to auto-join after authentication
    if (typeof window !== 'undefined' && state.network?.id) {
      localStorage.setItem('pending_network_join', state.network.id);
    }
    openLoginModal();
  };

  const renderContent = () => {
    switch (state.step) {
      case 'loading':
        return (
          <ContentContainer>
            <div className="flex flex-col items-center justify-center py-12">
              <Loader2 className="h-8 w-8 animate-spin text-gray-400 mb-4" />
              <p className="text-gray-600 font-ibm-plex-mono">Loading network...</p>
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
              <h1 className="text-2xl font-bold text-black mb-2 font-ibm-plex-mono">Not Found</h1>
              <p className="text-gray-600 font-ibm-plex-mono">
                {state.error || 'This network was not found or is private.'}
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
                You're about to join this network
              </h1>
              <p className="text-black text-[14px] font-ibm-plex-mono">
                Connect with others who share your intent — discover relevant matches inside this public network.
              </p>
            </div>
            
            {state.network && (
              <div className="bg-white border border-gray-200 rounded-lg p-8 mb-6">
                <div className="flex items-center gap-3 mb-4">
                  <Globe className="h-5 w-5 text-black" />
                  <h2 className="text-sm font-medium text-gray-600 font-ibm-plex-mono">
                    Public Network
                  </h2>
                </div>
                
                <h2 className="text-3xl font-bold text-black mb-6 font-ibm-plex-mono">
                  {state.network.title}
                </h2>
                
                {state.network._count && (
                  <div className="flex items-center gap-2 text-gray-600">
                    <Users className="h-4 w-4" />
                    <span className="text-sm font-ibm-plex-mono">
                      {state.network._count.members} {state.network._count.members === 1 ? 'member' : 'members'}
                    </span>
                  </div>
                )}
              </div>
            )}
            
            <div className="max-w-md">
              <Button
                onClick={handleLogin}
                className="bg-[#041729] text-white hover:bg-[#0a2d4a] font-ibm-plex-mono"
              >
                Sign in to join
              </Button>
            </div>
          </ContentContainer>
        );

      case 'ready-to-join':
        return (
          <ContentContainer>
            <div className="mb-8">
              <h1 className="text-2xl font-bold text-black mb-4 font-ibm-plex-mono">
                You're about to join this network
              </h1>
              <p className="text-black text-[14px] font-ibm-plex-mono">
                Connect with others who share your intent — discover relevant matches inside this public network.
              </p>
            </div>
            
            {state.network && (
              <div className="bg-white border border-gray-200 rounded-lg p-8 mb-6">
                <div className="flex items-center gap-3 mb-4">
                  <Globe className="h-5 w-5 text-black" />
                  <h2 className="text-sm font-medium text-gray-600 font-ibm-plex-mono">
                    Public Network
                  </h2>
                </div>
                
                <h2 className="text-3xl font-bold text-black mb-6 font-ibm-plex-mono">
                  {state.network.title}
                </h2>
                
                {state.network._count && (
                  <div className="flex items-center gap-2 text-gray-600">
                    <Users className="h-4 w-4" />
                    <span className="text-sm font-ibm-plex-mono">
                      {state.network._count.members} {state.network._count.members === 1 ? 'member' : 'members'}
                    </span>
                  </div>
                )}
              </div>
            )}
            
            <div className="max-w-md">
              <Button
                onClick={handleJoinNetwork}
                className="w-full bg-[#041729] text-white hover:bg-[#0a2d4a] font-ibm-plex-mono"
              >
                Join
              </Button>
            </div>
          </ContentContainer>
        );

      case 'joining':
        return (
          <ContentContainer>
            <div className="flex flex-col items-center justify-center py-12">
              <Loader2 className="h-8 w-8 animate-spin text-blue-600 mb-4" />
              <p className="text-gray-600 font-ibm-plex-mono">Joining network...</p>
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
                You're already a member of {state.network?.title}.
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


export const Component = PublicJoinPage;
