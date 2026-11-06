import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { useLocation, useNavigate } from "react-router";

import "@/styles/intents-home.css";
import Avatar from "@/components/intents-home/Avatar";
import { usePeople } from "@/components/intents-home/people";
import { useDismiss } from "@/components/intents-home/stages";
import InviteNetworksModal from "@/components/modals/InviteNetworksModal";
import { useAuthContext } from "@/contexts/AuthContext";
import { useAgents } from "@/contexts/APIContext";
import { useConversation } from "@/contexts/ConversationContext";
import { useIntentsData } from "@/contexts/IntentsDataContext";
import { useNetworksState } from "@/contexts/NetworksContext";
import { isVisibleH2HConversation } from "@/lib/conversation-visibility";

/** Which rail row the current page belongs to. */
function railKey(pathname: string): string {
  if (pathname === "/") return "home";
  if (pathname === "/i/new") return "new";
  if (pathname === "/opportunities" || pathname.startsWith("/i/")) return "opportunities";
  if (pathname === "/intents") return "intents";
  for (const root of ["/chat", "/u/", "/networks", "/agents", "/settings", "/negotiations"]) {
    if (pathname.startsWith(root)) return root === "/u/" ? "/chat" : root;
  }
  return "";
}

/**
 * The rail beside every signed-in desktop page: a new intent, then the three
 * places (home, opportunities, intents) and messages, then the rest and you.
 */
function AppRail({ onInvite }: { onInvite: () => void }) {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const { user, signOut } = useAuthContext();
  const agentsService = useAgents();
  const { networks } = useNetworksState();
  const { conversations } = useConversation();
  const { intents, waitingTotal, questionTotal } = useIntentsData();
  const { people } = usePeople();
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
  const needsYou = questionTotal + waitingTotal;
  // Each person once, however many intents they came up for.
  const found = people.filter((person) => person.entries[0].stage !== "closed").length;
  const live = intents.filter((intent) => (intent.status || "").toLowerCase() !== "paused").length;

  return (
    <nav className="ih-rail" aria-label="Main">
      <div className="ih-brand">index</div>
      <button type="button" className={`ih-new${row("new")}`} onClick={() => navigate("/i/new")}><span>+</span><span>new intent</span></button>
      <div className="ih-places">
        <button type="button" className={`ih-place${row("home")}`} onClick={() => navigate("/")}>
          <span className="ih-place-icon" aria-hidden="true" />
          <span>home</span>
          {needsYou > 0 && <span className="ih-badge" title={`${questionTotal} questions, ${waitingTotal} people waiting on you`}>{needsYou}</span>}
        </button>
        <button type="button" className={`ih-place${row("opportunities")}`} onClick={() => navigate("/opportunities")}>
          <span className="ih-place-icon diamond" aria-hidden="true" />
          <span>opportunities</span>
          {found > 0 && <span className="ih-n">{found}</span>}
        </button>
        <button type="button" className={`ih-place${row("intents")}`} onClick={() => navigate("/intents")}>
          <span className="ih-place-icon lines" aria-hidden="true" />
          <span>intents</span>
          {intents.length > 0 && <span className="ih-n">{live === intents.length ? intents.length : `${live} of ${intents.length} live`}</span>}
        </button>
        <button type="button" className={`ih-place${row("/chat")}`} onClick={() => navigate("/chat")}>
          <span className="ih-place-icon round" aria-hidden="true" />
          <span>messages</span>
          {unreadMessages > 0 && <span className="ih-n">{unreadMessages} unread</span>}
        </button>
      </div>

      <div className="ih-menu">
        <button type="button" className={`ih-menu-row${row("/networks")}`} onClick={() => navigate("/networks")}>
          <span>networks</span><span className="ih-n">{networks.length}</span>
        </button>
        <button type="button" className={`ih-menu-row${row("/agents")}`} onClick={() => navigate("/agents")}>
          <span>agents</span><span className="ih-n">{agentCount}</span>
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
                ["invite friends", onInvite],
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
