import { useEffect, useRef, useState } from "react";
import { useNavigate, useSearchParams, useParams, useLocation } from "react-router";
import { Loader2 } from "lucide-react";
import { useAuthContext } from "@/contexts/AuthContext";
import { useUsers, useOpportunities } from "@/contexts/APIContext";
import { User } from "@/lib/types";
import ChatView from "@/components/chat/ChatView";

export default function ChatPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const location = useLocation();
  const initialGroupId = searchParams.get('groupId') ?? undefined;
  const [initialState] = useState(() => {
    const s = location.state as { prefill?: string; autoSend?: boolean; opportunityId?: string } | null;
    if (s) window.history.replaceState({}, '');
    return s;
  });
  const prefillMessage = initialState?.prefill ?? searchParams.get('msg') ?? undefined;
  const autoSend = initialState?.autoSend ?? false;
  const pendingOpportunityId = initialState?.opportunityId ?? undefined;
  const { isAuthenticated, isLoading: authLoading, openLoginModal } = useAuthContext();
  const usersService = useUsers();
  const opportunitiesService = useOpportunities();
  const opportunityAcceptedRef = useRef(false);
  const loginPromptedRef = useRef(false);

  const [profileData, setProfileData] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!authLoading && !isAuthenticated && !loginPromptedRef.current) {
      loginPromptedRef.current = true;
      openLoginModal(window.location.href);
    }
  }, [authLoading, isAuthenticated, openLoginModal]);

  useEffect(() => {
    const fetchData = async () => {
      if (!isAuthenticated || authLoading) return;
      try {
        setIsLoading(true);
        setError(null);
        const profile = await usersService.getUserProfile(id!);
        setProfileData(profile);
      } catch (err) {
        console.error('Failed to fetch profile:', err);
        setError('User not found');
      } finally {
        setIsLoading(false);
      }
    };
    fetchData();
  }, [id!, isAuthenticated, authLoading, usersService]);

  const handleFirstMessageSent = async () => {
    if (!pendingOpportunityId || opportunityAcceptedRef.current) return;
    opportunityAcceptedRef.current = true;
    try {
      await opportunitiesService.updateStatus(pendingOpportunityId, "accepted");
    } catch (err) {
      console.error('[ChatPage] Failed to accept opportunity after message sent:', err);
    }
  };

  const handleClose = () => {
    navigate('/');
  };

  const handleBack = () => {
    navigate(-1);
  };

  if (authLoading || isLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-8 w-8 animate-spin text-gray-400" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center py-20">
        <h2 className="text-xl font-bold text-red-600 mb-2">Error</h2>
        <p className="text-gray-600 mb-4">{error}</p>
        <button
          onClick={() => navigate('/')}
          className="px-4 py-2 bg-[#041729] text-white rounded hover:bg-[#0a2d4a]"
        >
          Go Back
        </button>
      </div>
    );
  }

  if (!profileData) return null;

  return (
    <ChatView
      userId={profileData.id}
      userName={profileData.name}
      userAvatar={profileData.avatar || undefined}
      isGhost={profileData.isGhost}
      initialGroupId={initialGroupId}
      initialMessage={prefillMessage}
      autoSend={autoSend}
      onFirstMessageSent={pendingOpportunityId ? handleFirstMessageSent : undefined}
      onClose={handleClose}
      onBack={handleBack}
    />
  );
}

export const Component = ChatPage;
