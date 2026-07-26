// App — orchestrates the Mac System 6 prototype.
// Current flow: signals hub → onboarding/calibrating for new signals → main.

// Session. Quitting and reopening shouldn't dump you back at sign-in —
// only an explicit "sign out" should. The flag is written when the profile
// review is confirmed (the point where onboarding is actually complete) and
// cleared from the account menu.
//
// localStorage works here because main.swift sets allowFileAccessFromFileURLs
// on the file:// origin; the guards are for the case where it doesn't, in
// which case the app simply falls back to always starting at login.
const SESSION_KEY = "index.signedIn";

function readSession() {
  try { return window.localStorage.getItem(SESSION_KEY) === "1"; }
  catch (e) { return false; }
}

function writeSession(on) {
  try {
    if (on) window.localStorage.setItem(SESSION_KEY, "1");
    else window.localStorage.removeItem(SESSION_KEY);
  } catch (e) { /* no store — session just won't survive a relaunch */ }
}

function App() {
  const { PEOPLE, POOL, FIELD_EVENTS, INTENTS } = window.INDEX_DATA;
  const [screen, setScreen] = useState(() => readSession() ? "intents" : "login");
  // True until the user creates their first signal — the hub opens empty.
  const [freshUser, setFreshUser] = useState(false);
  const [profile, setProfile] = useState({});
  const [people, setPeople] = useState(() => [
    ...PEOPLE.map(p => ({ ...p, hidden: false })),
    ...POOL.map(p => ({ ...p, hidden: true })),
  ]);
  const [conversation, setConversation] = useState([]);
  const [field, setField] = useState([]);
  const [simRate, setSimRate] = useState(1);

  // Bridge: MainView publishes its chats (per active signal) up here so the top
  // menubar can show a 2-step menu — signals, and the chats within each — and
  // it persists across screens (so it works from the landing screen too).
  const [chatGroups, setChatGroups] = useState({}); // signalTitle -> [{id,name,unread}]
  const chatOpenRef = useRef(null);                  // { signal, open } for the active session
  const [pendingChat, setPendingChat] = useState(null);
  const registerChats = (signal, list, openFn) => {
    if (!signal) return;
    setChatGroups(prev => ({ ...prev, [signal]: list }));
    chatOpenRef.current = { signal, open: openFn };
  };

  const [accStats, setAccStats] = useState({ inspected: 47, online: 62 });
  useInterval(() => {
    setAccStats(s => ({
      inspected: s.inspected + (Math.random() < 0.7 ? 1 : 0) + (Math.random() < 0.3 ? 1 : 0),
      online:    s.online + (Math.random() < 0.5 ? 1 : -1),
    }));
  }, screen === "main" ? Math.max(900, 2500 / simRate) : null);

  const stats = useMemo(() => {
    const visible = people.filter(p => !p.hidden);
    const by = (s) => visible.filter(p => p.status === s).length;
    return {
      inspected: accStats.inspected,
      online: Math.max(40, accStats.online),
      surfaced: visible.filter(p => p.status !== "passed").length,
      negotiating: by("negotiating"),
      ready: by("ready"),
      warm: by("warm"),
      considering: by("considering"),
      passed: by("passed"),
      pool: people.filter(p => p.hidden).length,
    };
  }, [people, accStats]);

  const seedField = () => {
    setTimeout(() => {
      const seeds = FIELD_EVENTS.slice(0, 4).map(e => ({
        ...e, id: Math.random().toString(36).slice(2), t: Date.now(),
      }));
      setField(seeds);
    }, 400);
  };
  const pickExistingIntent = (intent) => {
    setProfile({
      intent: intent.title,
      edges: intent.edges,
      offLimits: intent.offLimits,
      shape: intent.shape || "warm",
    });
    setScreen("main");
    seedField();
  };
  const goOnboarding = () => setScreen("onboarding");
  const finishOnboarding = (answers) => {
    setProfile({
      intent: answers.intent,
      edges: answers.edges,
      offLimits: answers["off-limits"],
      shape: answers.shape || "warm",
    });
    setConversation([]);
    setField([]);
    setFreshUser(false);   // they've created a signal — hub is no longer empty
    setScreen("main");
    seedField();
  };

  // Open a chat from the menubar. If its signal is the active session, open it
  // directly; otherwise resume that signal first, then open once main mounts.
  const openChatFromMenu = (signal, personId) => {
    if (screen === "main" && chatOpenRef.current && chatOpenRef.current.signal === signal) {
      chatOpenRef.current.open(personId);
    } else {
      const intent = INTENTS.find(i => i.title === signal);
      if (intent) { pickExistingIntent(intent); setPendingChat(personId); }
    }
  };

  return (
    <React.Fragment>
      <div style={{
        position:"fixed", inset:0,
        overflow:"hidden",
      }} className="mac-desktop">
        {screen === "login"       && <Login onSignIn={() => setScreen("building")}/>}
        {/* Agent assembles the profile, then we show it for review. */}
        {screen === "building"    && <BuildingProfile onDone={() => setScreen("profile")}/>}
        {/* First run: review the profile we assembled, then into the hub.
            Confirming is the only way past this gate — declining (footer or
            titlebar gadget) returns to sign-in with nothing written, so the
            review replays on the next sign-in rather than being silently
            treated as approved. */}
        {screen === "profile"     && <Settings
                                       initialTab="profile"
                                       profileOnly
                                       onClose={() => { writeSession(false); setScreen("login"); }}
                                       onDone={() => {
                                         // confirming the profile is what completes onboarding,
                                         // so it's also what starts the remembered session
                                         writeSession(true);
                                         setFreshUser(true);
                                         setScreen("intents");
                                       }}/>}
        {screen === "intents"     && <Intents
                                       fresh={freshUser}
                                       onPickExisting={pickExistingIntent}
                                       onNew={goOnboarding}
                                       onSignOut={() => { writeSession(false); setScreen("login"); }}/>}
        {screen === "onboarding"  && <Onboarding onDone={finishOnboarding} onBack={() => setScreen("intents")}/>}
        {screen === "main"        && (
          <MainView
            profile={profile}
            people={people} setPeople={setPeople}
            conversation={conversation} setConversation={setConversation}
            field={field} setField={setField}
            stats={stats}
            simRate={simRate} setSimRate={setSimRate}
            onBack={() => setScreen("intents")}
            registerChats={registerChats}
            pendingChat={pendingChat}
            onPendingHandled={() => setPendingChat(null)}
          />
        )}
      </div>
    </React.Fragment>
  );
}

function MacMenubar({ screen, signals = [], chatGroups = {}, onOpenChat }) {
  const [clock, setClock] = useState(macClock());
  const [chatsOpen, setChatsOpen] = useState(false);
  const [expanded, setExpanded] = useState(null); // which signal is expanded
  useEffect(() => {
    const t = setInterval(() => setClock(macClock()), 30000);
    return () => clearInterval(t);
  }, []);
  const groupUnread = (title) => (chatGroups[title] || []).reduce((a, c) => a + (c.unread || 0), 0);
  const totalUnread = signals.reduce((a, s) => a + groupUnread(s.title), 0);
  const rowHover = (on) => (e) => {
    e.currentTarget.style.background = on ? "#000" : "#fff";
    e.currentTarget.style.color = on ? "#FF8A00" : "#000";
  };
  return (
    <div className="mac-menubar">
      <span className="m bold">index</span>

      <span className="right">
        <span className="m subtle">
          { screen === "intents"    ? "index · your signals"
          : screen === "onboarding" ? "index · calibrating"
          : "" }
        </span>
        <span className="clock">{clock}</span>
      </span>
    </div>
  );
}
function macClock(){
  const d = new Date();
  let h = d.getHours(), m = String(d.getMinutes()).padStart(2,"0");
  const ampm = h >= 12 ? "PM" : "AM";
  h = h % 12 || 12;
  return `${h}:${m} ${ampm}`;
}

ReactDOM.createRoot(document.getElementById("root")).render(<App/>);
