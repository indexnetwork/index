import { createContext, useContext, useState, type ReactNode } from "react";

import "@/styles/plain.css";
import { Stage, Window } from "@/components/workbench/Workbench";
import { PlaceTitle, SplitView, Seg } from "@/components/intents-home/SplitView";
import { useCompact } from "@/hooks/useCompact";
import { useAuthContext } from "@/contexts/AuthContext";
import { useConversation } from "@/contexts/ConversationContext";
import { isVisibleH2HConversation } from "@/lib/conversation-visibility";

export type ChatFilter = "all" | "unread" | "new";
const ChatFilterContext = createContext<ChatFilter>("all");
/** Which conversations the list shows: all, unread, or not started yet. */
export const useChatFilter = () => useContext(ChatFilterContext);

/**
 * The box chat pages sit in. Desktop is a plain page like Home and Intents:
 * a head, then the conversation list beside the thread across the full page
 * width, split by thin grey rules. Compact keeps its own window, since it has
 * no desktop shell.
 */
export function ChatFrame({ list, onClose, children }: { list?: ReactNode; onClose?: () => void; children: ReactNode }) {
  const compact = useCompact();
  const { user } = useAuthContext();
  const { conversations } = useConversation();
  const [filter, setFilter] = useState<ChatFilter>("all");
  if (!compact) {
    // The same layout as home: the conversations on the left, the person you're talking to on the right.
    const visible = conversations.filter(isVisibleH2HConversation);
    const unread = visible.filter((c) => c.unreadCount > 0).length;
    const fresh = visible.filter((c) => !c.lastMessage && (c.participants ?? []).some((p) => p.participantId !== user?.id)).length;
    const toggle = (next: ChatFilter) => setFilter((now) => (now === next ? "all" : next));
    return (
      <ChatFilterContext.Provider value={filter}>
        <SplitView
          title={<PlaceTitle place="conversations">conversations</PlaceTitle>}
          seg={<Seg items={[
            { label: "all", n: visible.length, on: filter === "all", onClick: () => setFilter("all") },
            { label: "unread", n: unread, on: filter === "unread", onClick: () => toggle("unread") },
            { label: "not started", n: fresh, on: filter === "new", onClick: () => toggle("new") },
          ]} />}
          list={list}
          pane={children}
        />
      </ChatFilterContext.Provider>
    );
  }
  return (
    <Stage>
      <Window title="conversations" onClose={onClose} style={{ height: "100%" }}>
        <div style={{ display: "grid", gridTemplateColumns: list ? "280px minmax(0, 1fr)" : "minmax(0, 1fr)", minHeight: 0, flex: 1 }}>
          {list && <div style={{ borderRight: "2px solid #000", minHeight: 0, overflow: "hidden" }}>{list}</div>}
          <div style={{ minHeight: 0, minWidth: 0, display: "flex", flexDirection: "column" }}>{children}</div>
        </div>
      </Window>
    </Stage>
  );
}
