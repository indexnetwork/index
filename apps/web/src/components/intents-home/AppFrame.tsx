import type { ReactNode } from "react";
import { useLocation, useNavigate } from "react-router";

import "@/styles/intents-home.css";
import { useAuthContext } from "@/contexts/AuthContext";
import { useConversation } from "@/contexts/ConversationContext";
import { useIntentsData } from "@/contexts/IntentsDataContext";
import { isVisibleH2HConversation } from "@/lib/conversation-visibility";
import { HomeSectionsProvider } from "@/components/intents-home/homeSections";
import { jumpTo, useHomeSections } from "@/components/intents-home/homeSectionsContext";

type RailKey = "home" | "intents" | "chat" | "profile" | "settings" | "";

/** Which sidebar row the current page belongs to. */
function railKey(pathname: string, search: string): RailKey {
  if (pathname === "/") return "home";
  if (pathname === "/intents" || pathname.startsWith("/i/")) return "intents";
  if (pathname.startsWith("/chat") || pathname.startsWith("/u/")) return "chat";
  if (pathname.startsWith("/settings")) {
    const tab = new URLSearchParams(search).get("tab");
    return !tab || tab === "profile" ? "profile" : "settings";
  }
  if (pathname.startsWith("/networks") || pathname.startsWith("/agents") || pathname.startsWith("/negotiations")) return "settings";
  return "";
}

/** The sidebar beside every signed-in desktop page: plain links, the three places, then you. */
/** A workbench title bar: the window's name on black stripes. */
function TitleBar({ title }: { title: string }) {
  return (
    <div className="ih-titlebar" aria-hidden>
      <span className="ih-titlebar-box" />
      <span className="ih-titlebar-stripes"><span className="t">{title}</span></span>
    </div>
  );
}

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
      <TitleBar title="index" />
      <div className="ih-rail-body">
        {item("home", "home", "/", waiting)}
        {here === "home" && sections.length > 0 && (
          <ul className="ih-sub" aria-label="jump to">
            {sections.map((section) => (
              <li key={section.id}>
                <button type="button" className="ih-sub-link" onClick={() => jumpTo(section.id)}>
                  <span className="ih-nav-label">{section.label}</span>
                  {!!section.count && <span className="ih-sub-n">{section.count}</span>}
                </button>
              </li>
            ))}
          </ul>
        )}
        {item("intents", "intents", "/intents")}
        {item("chat", "chat", "/chat", unread)}

        <div className="ih-menu">
          {item("profile", "profile", "/settings")}
          {item("settings", "settings", "/settings?tab=notifications")}
          <button type="button" className="ih-nav" onClick={() => void signOut()}><span className="ih-nav-label">log out</span></button>
          {user?.name && <div className="ih-me">signed in as {user.name}</div>}
        </div>
      </div>
    </nav>
  );
}

const TITLES: Partial<Record<RailKey, string>> = { home: "home", intents: "intents" };

/** The signed-in desktop shell on the blue desktop: the sidebar window, then the page window. */
export default function AppFrame({ children }: { children: ReactNode }) {
  const { pathname, search } = useLocation();
  const here = railKey(pathname, search);
  // Home and the intents list are full windows here; other pages bring their own titles.
  const title = pathname === "/intents" ? TITLES.intents : pathname === "/" ? TITLES.home : undefined;
  return (
    <HomeSectionsProvider>
      <div className="ih">
        <AppRail here={here} />
        <main className="ih-main">
          {title && <TitleBar title={title} />}
          {children}
        </main>
      </div>
    </HomeSectionsProvider>
  );
}
