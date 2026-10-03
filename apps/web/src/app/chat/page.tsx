import { useEffect, useMemo } from "react";
import { useNavigate } from "react-router";
import { useAuthContext } from "@/contexts/AuthContext";
import { useConversation } from "@/contexts/ConversationContext";
import ChatSidebar from "@/components/ChatSidebar";
import { isVisibleH2HConversation } from "@/lib/conversation-visibility";
import { Stage, Window } from "@/components/workbench/Workbench";

export default function ChatLandingPage() {
  const navigate = useNavigate();
  const { user, isAuthenticated, isLoading: authLoading } = useAuthContext();
  const { conversations } = useConversation();

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

  useEffect(() => {
    if (latestPeerId) navigate(`/u/${latestPeerId}/chat`, { replace: true });
  }, [latestPeerId, navigate]);

  return (
    <Stage width={860} height="min(660px, calc(100vh - 112px))">
      <Window title="conversations" onClose={() => navigate("/")} style={{ height: "100%" }}>
        <div style={{ display: "grid", gridTemplateColumns: "280px minmax(0, 1fr)", minHeight: 0, flex: 1 }}>
          <div style={{ borderRight: "2px solid #000", minHeight: 0 }}>
            <ChatSidebar />
          </div>
          <div />
        </div>
      </Window>
    </Stage>
  );
}

export const Component = ChatLandingPage;
