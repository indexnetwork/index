import { useEffect, useMemo } from "react";
import { useNavigate } from "react-router";
import { useAuthContext } from "@/contexts/AuthContext";
import { useConversation } from "@/contexts/ConversationContext";
import ChatSidebar from "@/components/ChatSidebar";
import { isVisibleH2HConversation } from "@/lib/conversation-visibility";
import { Stage, Window } from "@/components/workbench/Workbench";
import { EmptyState } from "@/components/ui/EmptyState";
import { useCompact } from "@/hooks/useCompact";

export default function ChatLandingPage() {
  const navigate = useNavigate();
  const compact = useCompact();
  const { user, isAuthenticated, isLoading: authLoading } = useAuthContext();
  const { conversations, conversationsStatus } = useConversation();
  const hasConversations = conversations.some(isVisibleH2HConversation);

  const latestPeerId = useMemo(() => {
    const visible = conversations.filter(isVisibleH2HConversation).slice().sort(
      (a, b) => new Date(b.lastMessageAt ?? b.createdAt).getTime() - new Date(a.lastMessageAt ?? a.createdAt).getTime(),
    );
    const peer = visible[0]?.participants?.find((p) => p.participantType === "user" && p.participantId !== user?.id);
    return peer?.participantId ?? null;
  }, [conversations, user?.id]);

  useEffect(() => {
    if (!authLoading && !isAuthenticated) navigate("/", { replace: true });
  }, [authLoading, isAuthenticated, navigate]);

  // Desktop opens the latest thread beside the list. Compact shows one pane,
  // so /chat stays the list; jumping ahead would make back loop forever.
  useEffect(() => {
    if (latestPeerId && !compact) navigate(`/u/${latestPeerId}/chat`, { replace: true });
  }, [latestPeerId, compact, navigate]);

  if (compact) {
    return (
      <Stage>
        <Window title="conversations">
          <div style={{ flex: 1, minHeight: 0 }}>
            <ChatSidebar />
          </div>
        </Window>
      </Stage>
    );
  }

  // An empty list has nothing to sit beside. Loading and errors still use the
  // list column (skeleton, or try again).
  const listColumn = hasConversations || conversationsStatus !== "ready";

  return (
    <Stage width={860} height="min(660px, calc(100vh - 112px))">
      <Window title="conversations" onClose={() => navigate("/")} style={{ height: "100%" }}>
        <div style={{ display: "grid", gridTemplateColumns: listColumn ? "280px minmax(0, 1fr)" : "minmax(0, 1fr)", minHeight: 0, flex: 1 }}>
          {listColumn && (
            <div style={{ borderRight: "2px solid #000", minHeight: 0 }}>
              <ChatSidebar showEmpty={false} />
            </div>
          )}
          <div style={{ display: "grid", placeItems: "center", alignContent: "center", padding: 24, minHeight: 0, overflow: "auto" }}>
            {hasConversations ? (
              <EmptyState message="pick a conversation." />
            ) : conversationsStatus === "ready" ? (
              <EmptyState
                framed
                style={{ maxWidth: 360 }}
                message="no conversations yet. a chat opens when you and someone both accept an intro."
                action={{ label: "start a signal", to: "/i/new" }}
              />
            ) : null}
          </div>
        </div>
      </Window>
    </Stage>
  );
}

export const Component = ChatLandingPage;
