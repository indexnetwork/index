import { useCallback, useEffect, type ReactNode } from "react";
import { useLocation, useNavigate } from "react-router";

import "@/styles/intents-home.css";
import { useAuthContext } from "@/contexts/AuthContext";
import { useConversation } from "@/contexts/ConversationContext";
import { useIntentsData } from "@/contexts/IntentsDataContext";
import { isVisibleH2HConversation } from "@/lib/conversation-visibility";
import { AgentWindowProvider } from "@/components/intents-home/agentWindow";
import { useAgentWindow } from "@/components/intents-home/agentWindowContext";
import MatchWindow from "@/components/intents-home/MatchWindow";
import { InAppFrameContext } from "@/components/intents-home/appFrameContext";
import HomeAgentPanel from "@/components/intents-home/HomeAgentPanel";
import { HomeSectionsProvider } from "@/components/intents-home/homeSections";
import { DEFAULT_HOME_SECTIONS, jumpTo, useHomeSections } from "@/components/intents-home/homeSectionsContext";

type RailKey = "home" | "intents" | "chat" | "profile" | "networks" | "settings" | "";

/** Which sidebar row the current page belongs to. */
function railKey(pathname: string, search: string, me?: string): RailKey {
  if (me && (pathname === `/u/${me}` || pathname === `/u/${me}/`)) return "profile";
  if (pathname === "/") return "home";
  if (pathname === "/intents" || pathname.startsWith("/i/")) return "intents";
  if (pathname.startsWith("/chat") || /^\/u\/[^/]+\/chat(\/|$)/.test(pathname)) return "chat";
  if (pathname.startsWith("/settings")) {
    const tab = new URLSearchParams(search).get("tab");
    return tab === "profile" ? "profile" : "settings";
  }
  if (pathname.startsWith("/networks")) return "networks";
  if (pathname.startsWith("/agents") || pathname.startsWith("/negotiations")) return "settings";
  return "";
}

/** The sidebar beside every signed-in desktop page: plain links, the three places, then you. */
function AppRail({ here }: { here: RailKey }) {
  const navigate = useNavigate();
  const { user, signOut } = useAuthContext();
  const { conversations } = useConversation();
  const { entriesByIntent } = useIntentsData();
  const sections = useHomeSections();

  const unread = conversations
    .filter(isVisibleH2HConversation)
    .reduce((total, conv) => total + (conv.unreadCount > 0 ? conv.unreadCount : 0), 0);
  const waiting = Object.values(entriesByIntent).reduce((sum, entries) => sum + entries.filter((e) => e.stage === "awaiting").length, 0);

  const item = (key: Exclude<RailKey, "">, label: string, to: string, count = 0) => (
    <button type="button" className={`ih-nav${here === key ? " on" : ""}`} aria-current={here === key ? "page" : undefined} onClick={() => navigate(to)}>
      <span className="ih-nav-label">{label}</span>
      {count > 0 && <span className="ih-badge">{count}</span>}
    </button>
  );

  return (
    <nav className="ih-rail" aria-label="main">
      <div className="ih-brand">index</div>
      <div className="ih-rail-body">
        {item("home", "home", "/", waiting)}
        {/* Home's sections stay listed on every page; from elsewhere they open Home there. */}
        <ul className="ih-sub" aria-label="jump to">
            {(sections.length ? sections : DEFAULT_HOME_SECTIONS).map((section) => (
              <li key={section.id}>
                <button type="button" className="ih-sub-link" onClick={() => { if (here !== "home") navigate("/"); jumpTo(section.id); }}>
                  <span className="ih-nav-label">{section.label}</span>
                  {section.loading
                    ? <span className="ih-sub-n ih-sub-loading" aria-label="loading">{section.count ? `${section.count} ` : ""}<span className="ih-blink">…</span></span>
                    : !!section.count && <span className="ih-sub-n">{section.count}</span>}
                </button>
              </li>
            ))}
        </ul>
        {item("intents", "intents", "/intents")}
        {item("chat", "chat", "/chat", unread)}

        <div className="ih-menu">
          {item("profile", "profile", user?.id ? `/u/${user.id}` : "/settings")}
          {item("networks", "networks", "/networks")}
          {item("settings", "settings", "/settings?tab=notifications")}
          <button type="button" className="ih-nav" onClick={() => void signOut()}><span className="ih-nav-label">log out</span></button>
          {user?.name && <div className="ih-me">signed in as {user.name}</div>}
        </div>
      </div>
    </nav>
  );
}

/** The agent's own window beside Home, opened from Home's "talk to your agent". */
function AgentWindow() {
  const { open, setOpen } = useAgentWindow();
  const { intents, fetchIntents, loadRadar } = useIntentsData();
  // After the agent changes something, show it: reread intents and everyone's stage.
  const onChanged = useCallback(() => {
    void fetchIntents();
    for (const intent of intents) void loadRadar(intent.id, "skeleton");
  }, [fetchIntents, intents, loadRadar]);
  if (!open) {
    // Closed, the chat stays docked on the right as a thin strip; a click opens it.
    return (
      <button type="button" className="ih-agentdock" aria-label="open your agent" title="talk to your agent" onClick={() => setOpen(true)}>
        <span className="ih-agentdock-arrow" aria-hidden>◂</span>
        <span className="ih-agentdock-label">talk to your agent</span>
      </button>
    );
  }
  return (
    <section className="ih-agentwin" aria-label="your agent">
      <HomeAgentPanel onChanged={onChanged} onClose={() => setOpen(false)} />
    </section>
  );
}

/** Beside Home: an open match takes the agent window's place until it's closed. */
function RightWindow() {
  const { log, setLog, open, setOpen } = useAgentWindow();
  // Esc closes what's open on the right: an opened match first, then the agent chat.
  // A half-typed message in the chat keeps it open, so Esc never throws a draft away.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      if (log) { setLog(null); return; }
      const target = event.target as HTMLElement | null;
      const typing = target && (target.tagName === "TEXTAREA" || target.tagName === "INPUT") && (target as HTMLTextAreaElement).value.trim() !== "";
      if (open && !typing) setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [log, setLog, open, setOpen]);
  return log ? <MatchWindow /> : <AgentWindow />;
}

/** The signed-in desktop shell on the blue desktop: the sidebar window, the page window, and on Home the agent's window. */
export default function AppFrame({ children }: { children: ReactNode }) {
  const { pathname, search } = useLocation();
  const { user } = useAuthContext();
  const here = railKey(pathname, search, user?.id);
  return (
    <HomeSectionsProvider>
      <AgentWindowProvider>
        <div className="ih">
          <AppRail here={here} />
          <main className="ih-main">
            <InAppFrameContext.Provider value>{children}</InAppFrameContext.Provider>
          </main>
          {pathname === "/" && <RightWindow />}
        </div>
      </AgentWindowProvider>
    </HomeSectionsProvider>
  );
}
