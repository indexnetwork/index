import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { useLocation, useNavigate } from "react-router";

import "@/styles/intents-home.css";
import "@/styles/buttons.css";
import "@/styles/split.css";
import { useAuthContext } from "@/contexts/AuthContext";
import { awaitsFirstIntent } from "@/services/onboarding";
import UserAvatar from "@/components/UserAvatar";
import { useConversation } from "@/contexts/ConversationContext";
import { useIntentsData } from "@/contexts/IntentsDataContext";
import { isVisibleH2HConversation } from "@/lib/conversation-visibility";
import { AgentWindowProvider } from "@/components/intents-home/agentWindow";
import { useAgentWindow } from "@/components/intents-home/agentWindowContext";
import MatchWindow from "@/components/intents-home/MatchWindow";
import { InAppFrameContext } from "@/components/intents-home/appFrameContext";
import ConnectAgent from "@/components/intents-home/ConnectAgent";
import PersonalAgentPanel from "@/components/intents-home/PersonalAgentPanel";
import IntentAgentPanel from "@/components/intents-home/IntentAgentPanel";
import { HomeSectionsProvider } from "@/components/intents-home/homeSections";
import { DEFAULT_HOME_SECTIONS, jumpTo, useHomeSections, usePublishHomeSections } from "@/components/intents-home/homeSectionsContext";
import { usePersonalQuestions } from "@/components/intents-home/usePersonalQuestions";
import { personKey, RANK, type Stage } from "@/components/intents-home/stages";
import { Placeholder } from "@/components/ui/Placeholder";
import { KeyboardProvider, JumpButton, useZone } from "@/components/intents-home/keyboard";
import { UndoProvider } from "@/components/intents-home/undo";

type RailKey = "home" | "intents" | "chat" | "introduce" | "profile" | "networks" | "settings" | "";

/** Which sidebar row the current page belongs to. */
function railKey(pathname: string, search: string, me?: string, username?: string | null): RailKey {
  if (pathname === "/profile" || pathname.startsWith("/profile/") || (username && (pathname === `/${username}` || pathname === `/${username}/`))) return "profile";
  if (me && (pathname === `/u/${me}` || pathname === `/u/${me}/`)) return "profile";
  if (pathname === "/") return "home";
  if (pathname === "/intents" || pathname.startsWith("/i/")) return "intents";
  if (pathname.startsWith("/chat") || /^\/u\/[^/]+\/chat(\/|$)/.test(pathname)) return "chat";
  if (pathname.startsWith("/settings")) {
    const tab = new URLSearchParams(search).get("tab");
    return tab === "profile" ? "profile" : "settings";
  }
  if (pathname.startsWith("/introduce")) return "introduce";
  if (pathname.startsWith("/networks")) return "networks";
  if (pathname.startsWith("/agents")) return "settings";
  if (pathname.startsWith("/negotiations")) return "settings";
  return "";
}

/**
 * Opened somewhere other than Home first: count Home's sections here so the
 * sidebar shows them anyway. Home takes over once it draws.
 */
function RailCounts() {
  const { entriesByIntent } = useIntentsData();
  const { questions, loaded } = usePersonalQuestions();
  const best = new Map<string, Stage>();
  for (const entries of Object.values(entriesByIntent)) {
    for (const entry of entries) {
      const key = personKey(entry.item);
      const now = best.get(key);
      if (!now || RANK[entry.stage] < RANK[now]) best.set(key, entry.stage);
    }
  }
  const stages = [...best.values()];
  usePublishHomeSections(loaded ? [
    { id: "questions", label: "questions", count: questions.length },
    { id: "waiting", label: "waiting on you", count: stages.filter((s) => s === "awaiting").length },
    { id: "progress", label: "in progress", count: stages.filter((s) => s === "talks" || s === "chat").length },
  ] : []);
  return null;
}

/** The sidebar beside every signed-in desktop page: plain links, the three places, then you. */
function AppRail({ here }: { here: RailKey }) {
  const navigate = useNavigate();
  const { user } = useAuthContext();
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

  const zone = useZone();
  return (
    <>
    {here !== "home" && <RailCounts />}
    <nav className={`ih-rail${zone === "rail" ? " sv-focus" : ""}`} aria-label="main" data-zone="rail">
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
                    ? <span className="ih-sub-n ih-sub-loading"><Placeholder.Count /></span>
                    : !!section.count && <span className="ih-sub-n">{section.count}</span>}
                </button>
              </li>
            ))}
        </ul>
        {item("intents", "intents", "/intents", waiting)}
        {item("chat", "conversations", "/chat", unread)}
        {item("introduce", "introduce", "/introduce")}

        <div className="ih-foot">
          <JumpButton />
          <ConnectAgent />
          <div className="ih-menu">
            {item("profile", "profile", user?.id ? `/u/${user.id}` : "/settings")}
            {item("networks", "networks", "/networks")}
            {item("settings", "settings", "/settings?tab=notifications")}
            <AccountMenu />
          </div>
        </div>
      </div>
    </nav>
    </>
  );
}

/** You, at the foot of the sidebar: your photo and name; a click opens log out above it (as on x.com). */
function AccountMenu() {
  const { user, signOut } = useAuthContext();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") { event.preventDefault(); setOpen(false); }
    };
    document.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);


  return (
    <div className="ih-account" ref={ref}>
      {open && (
        <div className="ih-account-menu" role="menu">
          <button type="button" role="menuitem" className="ih-account-out" onClick={() => { setOpen(false); void signOut(); }}>
            log out
          </button>
        </div>
      )}
      <button
        type="button"
        className={`ih-account-btn${open ? " open" : ""}`}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <UserAvatar id={user?.id} name={user?.name} avatar={user?.avatar} size={28} />
        <span className="ih-account-who">
          <span className="ih-account-name">{user?.name || "you"}</span>
          {user?.email && <span className="ih-account-sub">{user.email}</span>}
        </span>
        <span className="ih-account-more" aria-hidden>···</span>
      </button>
    </div>
  );
}

/** The agent's own window beside Home, opened from Home's "talk to your agent". */
function AgentWindow({ inPane = false }: { inPane?: boolean }) {
  const { open, setOpen } = useAgentWindow();
  const { intents, fetchIntents, loadRadar } = useIntentsData();
  // After the agent changes something, show it: reread intents and everyone's stage.
  const onChanged = useCallback(() => {
    void fetchIntents();
    for (const intent of intents) void loadRadar(intent.id, "skeleton");
  }, [fetchIntents, intents, loadRadar]);
  // On the right of Home's list, your agent is what shows when nobody is picked.
  if (inPane) return <div className="sv-agent"><PersonalAgentPanel onChanged={onChanged} /></div>;
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
      <PersonalAgentPanel onChanged={onChanged} onClose={() => setOpen(false)} />
    </section>
  );
}

/** Beside an intent: that intent's agent, always open (it's half of the page). */
function IntentAgentWindow({ intentId }: { intentId: string }) {
  const { intents } = useIntentsData();
  const intent = intents.find((i) => i.id === intentId);
  if (!intent) return null;
  const paused = (intent.status || "").toLowerCase() === "paused";
  return (
    <section className="ih-agentwin" aria-label="this intent's agent">
      <IntentAgentPanel key={intentId} intentId={intentId} paused={paused} createdAt={intent.createdAt} />
    </section>
  );
}

/**
 * Beside Home or an intent: an open match takes the agent window's place
 * until it's closed. On an intent page the agent there is that intent's.
 */
export function RightWindow({ intentId, inPane = false }: { intentId?: string; inPane?: boolean }) {
  const { pathname } = useLocation();
  const { log, setLog, open, setOpen } = useAgentWindow();
  // A match belongs to the page it was opened from.
  useEffect(() => { setLog(null); }, [pathname, setLog]);
  // Esc closes what's open on the right: an opened match first, then the agent chat.
  // A half-typed message in the chat keeps it open, so Esc never throws a draft away.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      const target = event.target as HTMLElement | null;
      const typing = target && (target.tagName === "TEXTAREA" || target.tagName === "INPUT") && (target as HTMLTextAreaElement).value.trim() !== "";
      if (log) { if (log.view !== "chat" || !typing) setLog(null); return; }
      if (open && !typing && !intentId) setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [log, setLog, open, setOpen, intentId]);
  if (log) return <MatchWindow />;
  return intentId ? <IntentAgentWindow intentId={intentId} /> : <AgentWindow inPane={inPane} />;
}

/** The signed-in desktop shell on the blue desktop: the sidebar window, the page window, and on Home the agent's window. */
export default function AppFrame({ children }: { children: ReactNode }) {
  const { pathname, search } = useLocation();
  const { user } = useAuthContext();
  const here = railKey(pathname, search, user?.id, user?.username);
  // The first intent is the last onboarding step: no rail, and the page is a card on the
  // blue desktop like the steps before it. Creating the picks finishes onboarding
  // mid-flow, so the choice holds until the page changes.
  const awaiting = pathname === "/i/new" && awaitsFirstIntent(user);
  const [firstIntent, setFirstIntent] = useState(false);
  if (awaiting && !firstIntent) setFirstIntent(true);
  if (pathname !== "/i/new" && firstIntent) setFirstIntent(false);
  const bare = awaiting || firstIntent;
  return (
    <HomeSectionsProvider>
      <AgentWindowProvider>
        <UndoProvider>
          <KeyboardProvider>
            <div className={bare ? "ih ih-first" : "ih"}>
              {!bare && <AppRail here={here} />}
              <main className="ih-main">
                <InAppFrameContext.Provider value>{children}</InAppFrameContext.Provider>
              </main>
            </div>
          </KeyboardProvider>
        </UndoProvider>
      </AgentWindowProvider>
    </HomeSectionsProvider>
  );
}
