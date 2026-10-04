import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useSearchParams, useParams, useLocation } from "react-router";
import { Loader2 } from "lucide-react";
import { useAuthContext } from "@/contexts/AuthContext";
import { useUsers } from "@/contexts/APIContext";
import { useConversation } from "@/contexts/ConversationContext";
import { User } from "@/lib/types";
import ChatView from "@/components/chat/ChatView";
import ChatSidebar from "@/components/ChatSidebar";
import { Stage, Window } from "@/components/workbench/Workbench";
import { EmptyState } from "@/components/ui/EmptyState";
import { APIError, isNotFoundError } from "@/lib/api";
import { log } from "@/lib/logger";

const logger = log.page.from("u/[id]/chat");

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
  const openedForId = useRef(id);
  const prefillMessage = openedForId.current === id
    ? (initialState?.prefill ?? searchParams.get('msg') ?? undefined)
    : undefined;
  const autoSend = openedForId.current === id && (initialState?.autoSend ?? false);
  const { isAuthenticated, isLoading: authLoading, openLoginModal } = useAuthContext();
  const usersService = useUsers();
  const { conversations } = useConversation();
  const loginPromptedRef = useRef(false);

  const [profileData, setProfileData] = useState<User | null>(null);
  const [error, setError] = useState<"notFound" | "failed" | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  const cachedPeer = useMemo(() => {
    if (!id) return null;
    for (const conversation of conversations) {
      const peer = conversation.participants?.find((participant) => participant.participantType === "user" && participant.participantId === id);
      if (peer) return peer;
    }
    return null;
  }, [conversations, id]);
  const profile = profileData?.id === id ? profileData : null;

  useEffect(() => {
    if (!authLoading && !isAuthenticated && !loginPromptedRef.current) {
      loginPromptedRef.current = true;
      openLoginModal(window.location.href);
    }
  }, [authLoading, isAuthenticated, openLoginModal]);

  useEffect(() => {
    if (!isAuthenticated || authLoading || !id) return;
    let cancelled = false;
    setError(null);
    usersService.getUserProfile(id).then((next) => {
      if (!cancelled) setProfileData(next);
    }).catch((err: unknown) => {
      if (cancelled) return;
      logger.error('Failed to fetch profile', { error: err });
      // getUserProfile throws a plain Error when a 200 carries no user: treat that as missing too.
      setError(isNotFoundError(err) || !(err instanceof APIError) ? "notFound" : "failed");
    });
    return () => { cancelled = true; };
  }, [id, isAuthenticated, authLoading, usersService, reloadKey]);

  const leave = () => navigate("/");

  if (authLoading || !isAuthenticated) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-8 w-8 animate-spin text-gray-400" />
      </div>
    );
  }

  const userName = profile?.name || cachedPeer?.name || "";
  const showMissingUser = Boolean(error && !profile && !cachedPeer);

  return (
    <Stage width={860} height="min(660px, calc(100vh - 112px))">
      <Window title="conversations" onClose={leave} style={{ height: "100%" }}>
        <div style={{ display: "grid", gridTemplateColumns: "280px minmax(0, 1fr)", minHeight: 0, flex: 1 }}>
          <div style={{ borderRight: "2px solid #000", minHeight: 0, overflow: "hidden" }}>
            <ChatSidebar />
          </div>
          <div style={{ minHeight: 0, minWidth: 0, display: "flex", flexDirection: "column" }}>
            {showMissingUser ? (
              <div style={{ flex: 1, display: "grid", placeItems: "center", padding: 24 }}>
                {error === "notFound" ? (
                  <EmptyState message="couldn't find this person." action={{ label: "go back", onClick: leave }} />
                ) : (
                  <EmptyState
                    tone="error"
                    message="couldn't load this person."
                    action={{ label: "try again", onClick: () => setReloadKey((k) => k + 1) }}
                  />
                )}
              </div>
            ) : id ? (
              <ChatView
                key={id}
                userId={id}
                userName={userName || "someone"}
                userAvatar={profile?.avatar || cachedPeer?.avatar || undefined}
                initialGroupId={initialGroupId}
                initialMessage={prefillMessage}
                autoSend={autoSend}
                onClose={leave}
                onBack={leave}
              />
            ) : null}
          </div>
        </div>
      </Window>
    </Stage>
  );
}

export const Component = ChatPage;
