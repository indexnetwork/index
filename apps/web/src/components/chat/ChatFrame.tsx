import type { ReactNode } from "react";

import "@/styles/plain.css";
import { Stage, Window } from "@/components/workbench/Workbench";
import PageHead from "@/components/intents-home/PageHead";
import { useCompact } from "@/hooks/useCompact";

/**
 * The box chat pages sit in. Desktop is a plain page like Home and Intents:
 * a head, then the conversation list beside the thread across the full page
 * width, split by thin grey rules. Compact keeps its own window, since it has
 * no desktop shell.
 */
export function ChatFrame({ list, onClose, children }: { list?: ReactNode; onClose?: () => void; children: ReactNode }) {
  const compact = useCompact();
  if (!compact) {
    return (
      <div className="ih-view pl pl-chat-page">
        <div className="pl-col pl-chat-col">
          <PageHead title="conversations" centered />
          <div className={list ? "ih-chat" : "ih-chat solo"}>
            {list && <div className="ih-chat-list">{list}</div>}
            <div className="ih-chat-pane">{children}</div>
          </div>
        </div>
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
