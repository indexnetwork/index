import { useEffect, useState, type ReactNode } from "react";
import { useLocation, useNavigate } from "react-router";

import UserAvatar from "@/components/UserAvatar";
import InviteNetworksModal from "@/components/modals/InviteNetworksModal";
import { QCount } from "@/components/workbench/Workbench";
import { AgentGlyph, ChatGlyph, SignalGlyph } from "@/components/workbench/nav-glyphs";
import { useAuthContext } from "@/contexts/AuthContext";
import { useConversation } from "@/contexts/ConversationContext";
import { useNetworksState } from "@/contexts/NetworksContext";
import { isVisibleH2HConversation } from "@/lib/conversation-visibility";

/** Screens that show the tab bar. Anything deeper is a drill-in with a back box instead. */
export function isTabRoot(pathname: string): boolean {
  return pathname === "/" || pathname === "/chat" || pathname === "/agents";
}

type TabId = "signals" | "chats" | "agents" | "you";

function Tab({ label, icon, active, badge, onClick }: {
  label: string;
  icon: ReactNode;
  active: boolean;
  badge?: number;
  onClick: () => void;
}) {
  return (
    <button type="button" className="wb-tab" aria-current={active ? "page" : undefined} onClick={onClick}>
      <span style={{ height: 22, display: "grid", placeItems: "center" }}>{icon}</span>
      {label}
      {badge ? <span className="wb-tab-badge">{badge > 99 ? "99+" : badge}</span> : null}
    </button>
  );
}

/**
 * Compact navigation. Desktop reaches these from the home window's shelf and
 * profile menu; on a phone the hub would mean a round trip for every hop, so
 * the primary places sit one tap away and the rest (networks included) live
 * in the "you" sheet.
 */
export default function MobileTabBar() {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const { user } = useAuthContext();
  const { conversations } = useConversation();
  const { networks } = useNetworksState();
  const [sheetOpen, setSheetOpen] = useState(false);
  const [inviteOpen, setInviteOpen] = useState(false);

  const unread = conversations
    .filter(isVisibleH2HConversation)
    .reduce((total, conv) => total + (conv.unreadCount > 0 ? conv.unreadCount : 0), 0);
  const pendingJoins = networks.reduce(
    (total, network) => total + ((network as { pendingJoinCount?: number }).pendingJoinCount ?? 0),
    0,
  );

  const active: TabId | null = pathname === "/" ? "signals" : pathname === "/chat" ? "chats" : pathname === "/agents" ? "agents" : null;

  // Route changes close the sheet, including the ones it starts.
  useEffect(() => { setSheetOpen(false); }, [pathname]);

  return (
    <>
      <nav className="wb-tabbar" aria-label="primary">
        <Tab label="signals" icon={<SignalGlyph />} active={active === "signals"} onClick={() => navigate("/")} />
        <Tab label="chats" icon={<ChatGlyph size={19} />} active={active === "chats"} badge={unread} onClick={() => navigate("/chat")} />
        <Tab label="agents" icon={<AgentGlyph size={22} />} active={active === "agents"} onClick={() => navigate("/agents")} />
        <Tab
          label="you"
          icon={<UserAvatar id={user?.id} name={user?.name} avatar={user?.avatar} size={22} />}
          active={sheetOpen}
          badge={pendingJoins}
          onClick={() => setSheetOpen(true)}
        />
      </nav>
      {sheetOpen && <YouSheet pendingJoins={pendingJoins} onClose={() => setSheetOpen(false)} onInvite={() => { setSheetOpen(false); setInviteOpen(true); }} />}
      {inviteOpen && (
        <div className="workbench mac-desktop" style={{ position: "fixed", inset: 0, zIndex: 130, display: "flex", flexDirection: "column" }}>
          <InviteNetworksModal onClose={() => setInviteOpen(false)} />
        </div>
      )}
    </>
  );
}

function YouSheet({ pendingJoins, onClose, onInvite }: { pendingJoins: number; onClose: () => void; onInvite: () => void }) {
  const navigate = useNavigate();
  const { user, signOut } = useAuthContext();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      e.stopPropagation();
      onClose();
    };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [onClose]);

  const rows: Array<{ label: string; to?: string; action?: () => void; badge?: number }> = [
    { label: "networks", to: "/networks", badge: pendingJoins },
    { label: "settings", to: "/settings" },
    { label: "negotiation history", to: "/negotiations" },
    { label: "notifications", to: "/settings?tab=notifications" },
    { label: "invite friends", action: onInvite },
  ];

  return (
    <div className="wb-sheet-scrim" onClick={onClose}>
      <div className="wb-sheet" role="menu" aria-label="you" onClick={(e) => e.stopPropagation()}>
        <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "14px 18px" }}>
          <UserAvatar id={user?.id} name={user?.name} avatar={user?.avatar} size={38} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontFamily: "var(--mac-mono)", fontSize: 14, fontWeight: 700, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{user?.name || "you"}</div>
            {user?.email && <div style={{ marginTop: 2, fontFamily: "var(--mac-mono)", fontSize: 11, color: "var(--ink-2)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{user.email}</div>}
          </div>
          <button type="button" className="wb-btn small" onClick={onClose}>done</button>
        </div>
        {rows.map((row) => (
          <button
            key={row.label}
            type="button"
            role="menuitem"
            className="wb-sheet-row"
            onClick={() => (row.action ? row.action() : navigate(row.to!))}
          >
            <span style={{ flex: 1 }}>{row.label}</span>
            {row.badge ? <QCount n={row.badge} title={`${row.badge} waiting on you: people asking to join`} /> : null}
            <span aria-hidden="true">›</span>
          </button>
        ))}
        <button type="button" role="menuitem" className="wb-sheet-row danger" onClick={() => { onClose(); void signOut(); }}>
          sign out
        </button>
      </div>
    </div>
  );
}
