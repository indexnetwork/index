import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useLocation, useNavigate } from "react-router";

import { useConversation } from "@/contexts/ConversationContext";
import { useIntentsData } from "@/contexts/IntentsDataContext";
import { personKey } from "@/components/intents-home/stages";
import { useAgentWindow } from "@/components/intents-home/agentWindowContext";
import { isVisibleH2HConversation } from "@/lib/conversation-visibility";

/**
 * Moving around without the mouse. ← / → pick the column (menu, list, the
 * right side); ↑ / ↓ (or j / k) act inside it: the menu switches page, the
 * list moves the selection, the right side scrolls. Esc closes what's open,
 * a / p accept or pass, s / c switch summary and chat, r jumps to the
 * message box, ? lists the keys, ⌘K jumps anywhere.
 *
 * Pages only mark their markup: list items carry `data-sv-item`, the selected
 * one `.on`; buttons the keys press carry `data-sv-key`.
 */
export type Zone = "rail" | "list" | "pane";
const ZONES: Zone[] = ["rail", "list", "pane"];
const PAGES = ["/", "/intents", "/chat", "/introduce"];

const ZoneContext = createContext<Zone>("list");
export const useZone = () => useContext(ZoneContext);

interface Jump { label: string; kind: string; run: () => void }

export function KeyboardProvider({ children }: { children: ReactNode }) {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const { intents, entriesByIntent } = useIntentsData();
  const { conversations } = useConversation();
  const { setLog } = useAgentWindow();
  const [zone, setZone] = useState<Zone>("list");
  const [palette, setPalette] = useState(false);
  const [help, setHelp] = useState(false);
  const [query, setQuery] = useState("");
  const [index, setIndex] = useState(0);

  // Clicking a column makes it the one the keys act on.
  useEffect(() => {
    const onDown = (event: MouseEvent) => {
      const col = (event.target as HTMLElement).closest?.("[data-zone]") as HTMLElement | null;
      const z = col?.dataset.zone as Zone | undefined;
      if (z && ZONES.includes(z)) setZone(z);
    };
    document.addEventListener("mousedown", onDown, true);
    return () => document.removeEventListener("mousedown", onDown, true);
  }, []);

  const jumps = useMemo<Jump[]>(() => {
    const people = new Map<string, Jump>();
    for (const entries of Object.values(entriesByIntent)) {
      for (const entry of entries) {
        const item = entry.item;
        const name = item.name || item.peer?.name;
        const key = personKey(item);
        if (!name || people.has(key)) continue;
        const userId = item.userId || item.peer?.userId;
        people.set(key, {
          label: name,
          kind: entry.stage === "awaiting" ? "waiting on you" : entry.stage === "chat" ? "chat" : entry.stage === "talks" ? "agents talking" : "closed",
          run: () => {
            if (entry.stage === "chat" && userId) { navigate(`/u/${userId}/chat`); return; }
            navigate("/");
            setTimeout(() => setLog({ opportunityId: item.opportunityId, intentId: entry.intentId, personKey: key, name, userId, avatar: item.avatar ?? item.peer?.avatar, notOnIndex: item.peer?.emailVerified === false, entries: [entry] }), 0);
          },
        });
      }
    }
    for (const conv of conversations.filter(isVisibleH2HConversation)) {
      const peer = conv.participants?.find((p) => p.participantType === "user" && p.participantId);
      if (!peer?.participantId || !peer.name || [...people.values()].some((j) => j.label === peer.name)) continue;
      people.set(`chat-${peer.participantId}`, { label: peer.name, kind: "chat", run: () => navigate(`/u/${peer.participantId}/chat`) });
    }
    return [
      { label: "home", kind: "page", run: () => navigate("/") },
      { label: "intents", kind: "page", run: () => navigate("/intents") },
      { label: "conversations", kind: "page", run: () => navigate("/chat") },
      { label: "introduce", kind: "page", run: () => navigate("/introduce") },
      { label: "new intent", kind: "write one", run: () => navigate("/i/new") },
      { label: "answer questions", kind: "home", run: () => { navigate("/"); setTimeout(() => document.getElementById("questions")?.scrollIntoView({ block: "start" }), 50); } },
      ...people.values(),
      ...intents.map((intent) => ({ label: intent.summary || intent.payload || "intent", kind: "intent", run: () => navigate(`/i/${intent.id}`) })),
    ];
  }, [entriesByIntent, conversations, intents, navigate, setLog]);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (q ? jumps.filter((j) => `${j.label} ${j.kind}`.toLowerCase().includes(q)) : jumps).slice(0, 9);
  }, [jumps, query]);
  const at = Math.min(index, Math.max(0, shown.length - 1));
  const runJump = (jump?: Jump) => { setPalette(false); setQuery(""); setIndex(0); jump?.run(); };

  const keys = useRef({ zone, palette, help, shown, at, runJump });
  useEffect(() => { keys.current = { zone, palette, help, shown, at, runJump }; });

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const { zone: z, palette: pal, help: hlp, shown: list, at: sel, runJump: run } = keys.current;
      const target = event.target as HTMLElement | null;
      const typing = !!target?.closest?.("input, textarea, [contenteditable='true']");
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault(); setPalette((v) => !v); setHelp(false); setQuery(""); setIndex(0); return;
      }
      if (pal) {
        if (event.key === "Escape") { event.preventDefault(); setPalette(false); }
        else if (event.key === "ArrowDown") { event.preventDefault(); setIndex((sel + 1) % Math.max(1, list.length)); }
        else if (event.key === "ArrowUp") { event.preventDefault(); setIndex((sel - 1 + list.length) % Math.max(1, list.length)); }
        else if (event.key === "Enter") { event.preventDefault(); run(list[sel]); }
        return;
      }
      if (event.key === "Escape") {
        if (hlp) { event.preventDefault(); setHelp(false); return; }
        if (typing) { target?.blur(); return; }
        return; // the page closes its own right side
      }
      if (typing || event.metaKey || event.ctrlKey || event.altKey || event.defaultPrevented) return;
      const k = event.key;
      if (k === "?") { event.preventDefault(); setHelp((v) => !v); return; }
      if (k === "ArrowLeft" || k === "ArrowRight") {
        event.preventDefault();
        const next = ZONES[Math.max(0, Math.min(2, ZONES.indexOf(z) + (k === "ArrowRight" ? 1 : -1)))];
        setZone(next === "pane" && !document.querySelector(".sv-pane") ? "list" : next);
        return;
      }
      const up = k === "ArrowUp" || k === "k", down = k === "ArrowDown" || k === "j";
      if (up || down) {
        if (z === "rail") {
          event.preventDefault();
          const here = PAGES.findIndex((p) => (p === "/" ? pathname === "/" : pathname.startsWith(p) || (p === "/intents" && pathname.startsWith("/i/")) || (p === "/chat" && /\/chat/.test(pathname))));
          navigate(PAGES[Math.max(0, Math.min(PAGES.length - 1, (here < 0 ? 0 : here) + (down ? 1 : -1)))]);
          return;
        }
        if (z === "pane") {
          event.preventDefault();
          document.querySelector<HTMLElement>(".sv-pane .sv-body, .sv-pane .pl-agent-log, .sv-pane [data-sv-scroll]")?.scrollBy({ top: down ? 120 : -120, behavior: "smooth" });
          return;
        }
        const items = [...document.querySelectorAll<HTMLElement>("[data-sv-list] [data-sv-item]")];
        if (!items.length) return;
        event.preventDefault();
        const now = items.findIndex((el) => el.classList.contains("on"));
        const next = items[now < 0 ? 0 : Math.max(0, Math.min(items.length - 1, now + (down ? 1 : -1)))];
        if (next && !next.classList.contains("on")) next.click();
        next?.scrollIntoView({ block: "nearest" });
        return;
      }
      const press = (name: string) => document.querySelector<HTMLElement>(`.sv-pane [data-sv-key="${name}"], [data-sv-list] .on [data-sv-key="${name}"]`)?.click();
      if (k === "a") { press("accept"); return; }
      if (k === "p") { press("pass"); return; }
      if (k === "s") { press("tab-summary"); return; }
      if (k === "c") { press("tab-chat"); return; }
      if (k === "r") {
        press("tab-chat");
        setTimeout(() => document.querySelector<HTMLElement>(".sv-pane textarea")?.focus(), 30);
        event.preventDefault();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [navigate, pathname]);

  return (
    <ZoneContext.Provider value={zone}>
      <div className={`sv-zones z-${zone}`} style={{ display: "contents" }}>{children}</div>
      {palette && (
        <div className="sv-layer">
          <div className="sv-scrim" onMouseDown={() => setPalette(false)} />
          <div className="sv-pal" role="dialog" aria-label="jump to">
            <input autoFocus value={query} placeholder="jump to a person, intent or page…" onChange={(event) => { setQuery(event.target.value); setIndex(0); }} />
            <div className="sv-palres">
              {shown.length ? shown.map((jump, i) => (
                <button type="button" key={`${jump.kind}-${jump.label}-${i}`} className={`sv-palrow${i === at ? " on" : ""}`} onMouseEnter={() => setIndex(i)} onClick={() => runJump(jump)}>
                  <span className="pl">{jump.label}</span><span className="pk">{jump.kind}</span>
                </button>
              )) : <div className="sv-palrow none">nothing matches.</div>}
            </div>
            <div className="sv-palfoot"><span>↑↓ move</span><span>↵ open</span><span>esc close</span></div>
          </div>
        </div>
      )}
      {help && (
        <div className="sv-layer">
          <div className="sv-scrim" onMouseDown={() => setHelp(false)} />
          <div className="sv-pal sv-help" role="dialog" aria-label="keyboard">
            <div className="sv-helph">keyboard</div>
            {[
              ["⌘K / ctrl K", "jump to anything"],
              ["← / →", "move between menu, list and the right side"],
              ["↑ / ↓  or  j / k", "menu: switch page · list: next / previous · right: scroll"],
              ["esc", "close what's open"],
              ["a / p", "accept / pass the selected person"],
              ["s / c", "summary / chat tab"],
              ["r", "reply: jump to the message box"],
              ["?", "this list"],
            ].map(([k, v]) => <div className="sv-hrow" key={k}><kbd>{k}</kbd><span>{v}</span></div>)}
            <div className="sv-palfoot"><span>esc close</span></div>
          </div>
        </div>
      )}
    </ZoneContext.Provider>
  );
}

/** "jump to… ⌘K" in the menu. */
export function JumpButton() {
  return (
    <button type="button" className="sv-jumpbtn" onClick={() => window.dispatchEvent(new KeyboardEvent("keydown", { key: "k", metaKey: true }))}>
      <span>jump to…</span><kbd>⌘K</kbd>
    </button>
  );
}
