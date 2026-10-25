import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { useLocation, useNavigate } from "react-router";

import "@/styles/intents-home.css";
import Avatar from "@/components/intents-home/Avatar";
import { useDismiss, type HomeIntent } from "@/components/intents-home/stages";
import InviteNetworksModal from "@/components/modals/InviteNetworksModal";
import { useAuthContext } from "@/contexts/AuthContext";
import { useAgents } from "@/contexts/APIContext";
import { useConversation } from "@/contexts/ConversationContext";
import { useIntentsData } from "@/contexts/IntentsDataContext";
import { useNetworksState } from "@/contexts/NetworksContext";
import { isVisibleH2HConversation } from "@/lib/conversation-visibility";
import { intentTitle } from "@/lib/intent-display";

const labelOf = (intent: HomeIntent) => intentTitle((intent.summary?.trim() || intent.payload).trim());

/** Which rail row the current page belongs to. */
function railKey(pathname: string): string {
  if (pathname === "/") return "all";
  if (pathname === "/i/new") return "new";
  const intent = /^\/i\/([^/]+)/.exec(pathname);
  if (intent) return `intent:${intent[1]}`;
  for (const root of ["/chat", "/u/", "/networks", "/agents", "/settings", "/negotiations"]) {
    if (pathname.startsWith(root)) return root === "/u/" ? "/chat" : root;
  }
  return "";
}

/** The rail beside every signed-in desktop page: intents, then the app's other places, then you. */
function AppRail({ onInvite }: { onInvite: () => void }) {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const { user, signOut } = useAuthContext();
  const agentsService = useAgents();
  const { networks } = useNetworksState();
  const { conversations } = useConversation();
  const { intents, intentsError, fetchIntents, activeCount } = useIntentsData();
  const [agentCount, setAgentCount] = useState(1);
  const [profileOpen, setProfileOpen] = useState(false);
  const profileRef = useRef<HTMLDivElement>(null);
  const closeProfile = useCallback(() => setProfileOpen(false), []);
  useDismiss(profileOpen, profileRef, closeProfile);

  useEffect(() => {
    let active = true;
    agentsService.list().then((agents) => {
      if (active) setAgentCount(Math.max(1, agents.filter((agent) => agent.status === "active").length));
    }).catch(() => {});
    return () => { active = false; };
  }, [agentsService]);

  const unreadMessages = conversations
    .filter(isVisibleH2HConversation)
    .reduce((total, conv) => total + (conv.unreadCount > 0 ? conv.unreadCount : 0), 0);
  const here = railKey(pathname);
  const row = (key: string) => (here === key ? " on" : "");

  return (
    <nav className="ih-rail">
      <div className="ih-rail-label">YOUR INTENTS</div>
      <button type="button" className={`ih-new${row("new")}`} onClick={() => navigate("/i/new")}><span>+</span><span>new intent</span></button>
      <button type="button" className={`ih-intent${row("all")}`} onClick={() => navigate("/")}>
        <span className="ih-intent-label">all</span>
        <span className="ih-n">{intents.reduce((sum, intent) => sum + activeCount(intent.id), 0)}</span>
      </button>
      {intents.map((intent) => {
        const isPaused = (intent.status || "").toLowerCase() === "paused";
        return (
          <button key={intent.id} type="button" title={intent.payload} className={`ih-intent${row(`intent:${intent.id}`)}${isPaused ? " paused" : ""}`} onClick={() => navigate(`/i/${intent.id}`)}>
            <span className="ih-intent-label">{labelOf(intent)}</span>
            <span className="ih-n">{activeCount(intent.id)}</span>
          </button>
        );
      })}
      {intentsError && !intents.length && (
        <div className="ih-intent" style={{ cursor: "default" }}>
          <span>couldn&apos;t load. <button type="button" className="ih-link" onClick={() => void fetchIntents()}>try again</button></span>
        </div>
      )}

      <div className="ih-menu">
        <button type="button" className={`ih-menu-row${row("/chat")}`} onClick={() => navigate("/chat")}>
          <span>conversations</span>
          {unreadMessages > 0 && <span className="ih-n" title={`${unreadMessages} unread`}>{unreadMessages}</span>}
        </button>
        <button type="button" className={`ih-menu-row${row("/networks")}`} onClick={() => navigate("/networks")}>
          <span>networks</span><span className="ih-n">{networks.length}</span>
        </button>
        <button type="button" className={`ih-menu-row${row("/agents")}`} onClick={() => navigate("/agents")}>
          <span>agents</span><span className="ih-n">{agentCount}</span>
        </button>
        <button type="button" className="ih-menu-row" onClick={onInvite}>
          <span>invite friends</span>
        </button>
        <div ref={profileRef} className="ih-profile-wrap">
          <button type="button" className={`ih-profile${here === "/settings" || here === "/negotiations" ? " on" : ""}`} aria-haspopup="menu" aria-expanded={profileOpen} onClick={() => setProfileOpen((v) => !v)}>
            <Avatar name={user?.name || "you"} photo={user?.avatar} size={22} />
            <span className="ih-profile-name">{user?.name || "you"}</span>
            <span style={{ color: "var(--ih-faint)" }}>{profileOpen ? "▾" : "▴"}</span>
          </button>
          {profileOpen && (
            <div role="menu" className="ih-pop" style={{ left: 0, right: 0, bottom: "calc(100% + 4px)" }}>
              {([
                ["settings", () => navigate("/settings")],
                ["notifications", () => navigate("/settings?tab=notifications")],
                ["agent log", () => navigate("/negotiations")],
                ["sign out", () => void signOut()],
              ] as const).map(([label, run]) => (
                <button key={label} type="button" role="menuitem" className="ih-pop-item" onClick={() => { setProfileOpen(false); run(); }}>
                  {label}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </nav>
  );
}

/**
 * The signed-in desktop shell: the rail, then the page. Invite friends opens
 * in the page's place, the way it did over the old home.
 */
export default function AppFrame({ children }: { children: ReactNode }) {
  const [inviteOpen, setInviteOpen] = useState(false);
  const { pathname } = useLocation();
  // Moving to another page leaves the invite behind.
  useEffect(() => { setInviteOpen(false); }, [pathname]);
  return (
    <div className="ih">
      <AppRail onInvite={() => setInviteOpen(true)} />
      <main className="ih-main">
        {inviteOpen ? <InviteNetworksModal onClose={() => setInviteOpen(false)} /> : children}
      </main>
    </div>
  );
}
