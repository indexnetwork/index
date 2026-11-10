import type { ReactNode } from "react";

import "@/styles/plain.css";
import { Stage, Window } from "@/components/workbench/Workbench";
import { useCompact } from "@/hooks/useCompact";

/**
 * The box chat pages sit in. Desktop fills the space beside the sidebar,
 * full height, with the conversation list beside the thread, both drawn in
 * the classic look (mono names, black rules, orange scrollbar). Compact keeps
 * its own window, since it has no desktop shell.
 */
export function ChatFrame({ list, onClose, children }: { list?: ReactNode; onClose?: () => void; children: ReactNode }) {
  const compact = useCompact();
  if (!compact) {
    return (
      <div className={list ? "ih-view ih-chat" : "ih-view ih-chat solo"}>
        {list && <div className="ih-chat-list">{list}</div>}
        <div className="ih-chat-pane">{children}</div>
      </div>
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
