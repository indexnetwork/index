import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useSearchParams, useParams, useLocation } from "react-router";
import { useAuthContext } from "@/contexts/AuthContext";
import { useUsers } from "@/contexts/APIContext";
import { useConversation } from "@/contexts/ConversationContext";
import { User } from "@/lib/types";
import ChatView from "@/components/chat/ChatView";
import ChatSidebar from "@/components/ChatSidebar";
import { ChatFrame } from "@/components/chat/ChatFrame";
import { useCompact } from "@/hooks/useCompact";
import { useBack } from "@/hooks/useBack";
import { EmptyState } from "@/components/ui/EmptyState";
import { APIError, isNotFoundError } from "@/lib/api";
import { log } from "@/lib/logger";
import { Placeholder } from "@/components/ui/Placeholder";
import { PersonPane, PersonSummary, type PersonTab } from "@/components/intents-home/PersonPane";

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

  const compact = useCompact();
  const back = useBack("/chat");
  // Compact threads are a drill-in, so the box goes back rather than home.
  const leave = compact ? back : () => navigate("/");

  if (authLoading || !isAuthenticated) {
    return (
      <div style={{ maxWidth: 560, margin: "0 auto", padding: "40px 16px" }}>
        <Placeholder.Thread label="loading this chat" />
      </div>
    );
  }

  const userName = profile?.name || cachedPeer?.name || "";
  const avatar = profile?.avatar || cachedPeer?.avatar || undefined;
  const showMissingUser = Boolean(error && !profile && !cachedPeer);

  return (
    <ChatFrame list={compact ? undefined : <ChatSidebar />} onClose={leave}>
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
      ) : id && !compact ? (
        // On the desktop the conversation is the person pane, opened on chat: who they are a tab away.
        <ConversationPane key={id} userId={id} name={userName || "someone"} avatar={avatar}>
          {(onCount) => <ChatView
            key={id}
            userId={id}
            userName={userName || "someone"}
            userAvatar={avatar}
            initialGroupId={initialGroupId}
            initialMessage={prefillMessage}
            autoSend={autoSend}
            onClose={leave}
            onBack={leave}
            bare
            onCount={onCount}
          />}
        </ConversationPane>
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
    </ChatFrame>
  );
}

export const Component = ChatPage;

/** The person you're talking to, opened on chat; summary shows who they are and what you were matched on. */
function ConversationPane({ userId, name, avatar, children }: { userId: string; name: string; avatar?: string; children: (onCount: (count: number) => void) => React.ReactNode }) {
  const [tab, setTab] = useState<PersonTab>("chat");
  const [count, setCount] = useState(0);
  return (
    <PersonPane
      person={{ name, userId, avatar }}
      tab={tab}
      onTab={setTab}
      chatCount={count}
      summary={<PersonSummary userId={userId} />}
      chat={children(setCount)}
    />
  );
}
