// App — orchestrates the Mac System 6 prototype against the live backend.
// Auth source of truth is the native Keychain credential surfaced as
// window.INDEX_NATIVE.apiKey (bridged through window.IndexApp). When there is no
// credential the app shows sign-in; INDEX_DATA is only a signed-out demo
// fallback for browser preview where the Swift bridge is absent.

// Live data (mapped snapshot + ME/NETWORKS) is threaded through this context so
// screens can prefer live data and fall back to the demo INDEX_DATA.
const IndexDataContext = React.createContext(null);
function useIndexData() {
  const ctx = React.useContext(IndexDataContext);
  return (ctx && ctx.data) || window.INDEX_DATA;
}
function useIndexEnv() {
  return React.useContext(IndexDataContext) || {
    data: window.INDEX_DATA, me: null, networks: null, features: {}, live: false,
  };
}

function nativeAuthed() {
  return !!(window.IndexApp && window.IndexApp.isAuthed());
}

function App() {
  const [screen, setScreen] = useState(() => nativeAuthed() ? "building" : "login");
  // True until the user creates their first signal — the hub opens empty.
  const [freshUser, setFreshUser] = useState(false);
  const [profile, setProfile] = useState({});
  // Live snapshot state; null until loadSnapshot() resolves (or in demo mode).
  const [snapshot, setSnapshot] = useState(null);
  const [me, setMe] = useState(null);
  const [networks, setNetworks] = useState(null);
  const [features, setFeatures] = useState({});
  const live = snapshot !== null;
  const data = snapshot || window.INDEX_DATA;
  const { PEOPLE, POOL, FIELD_EVENTS, INTENTS } = data;
  const [people, setPeople] = useState([]);
  const [conversation, setConversation] = useState([]);
  const [field, setField] = useState([]);
  const [simRate, setSimRate] = useState(1);
  // A fresh sign-in (vs an already-authed relaunch) goes through the original
  // profile-review gate after the building screen.
  const freshLoginRef = useRef(false);

  // React to native login/logout coming from the Swift shell.
  useEffect(() => {
    if (!window.IndexApp) return;
    return window.IndexApp.onAuthChanged((key) => {
      if (key) {
        setScreen("building");
      } else {
        setSnapshot(null); setMe(null); setNetworks(null);
        setScreen("login");
      }
    });
  }, []);

  // The "building" screen doubles as the boot loader: fetch the live snapshot,
  // then drop into the signals hub. Falls back to demo data when unauthenticated.
  useEffect(() => {
    if (screen !== "building") return;
    let cancelled = false;
    (async () => {
      let loaded = null;
      if (nativeAuthed() && window.IndexApp) {
        const [snap] = await Promise.all([
          window.IndexApp.loadSnapshot().catch(() => null),
          new Promise((r) => setTimeout(r, 1400)),
        ]);
        loaded = snap;
      }
      if (cancelled) return;
      if (loaded) {
        applyLoaded(loaded);
        setFreshUser((loaded.snapshot.INTENTS || []).length === 0);
      }
      // First run after a sign-in reviews the assembled profile, exactly like
      // the original flow; an already-signed-in relaunch goes straight in.
      setScreen(freshLoginRef.current ? "profile" : "intents");
    })();
    return () => { cancelled = true; };
  }, [screen]);

  // Fold a loaded snapshot into React state and mirror ME/NETWORKS/INTENTS onto
  // window.INDEX_DATA so the side screens (settings/networks) that still read it
  // directly show live data without prop threading.
  const applyLoaded = (loaded) => {
    setSnapshot(loaded.snapshot);
    setMe(loaded.me);
    setNetworks(loaded.networks);
    setFeatures(loaded.features || {});
    setPeople([
      ...(loaded.snapshot.PEOPLE || []).map(p => ({ ...p, hidden: false })),
      ...(loaded.snapshot.POOL || []).map(p => ({ ...p, hidden: true })),
    ]);
    Object.assign(window.INDEX_DATA, {
      ME: loaded.me,
      NETWORKS: loaded.networks,
      INTENTS: loaded.snapshot.INTENTS || [],
    });
  };

  const signOut = () => {
    if (window.IndexApp && window.IndexApp.logout()) {
      // onAuthChanged will reset the UI once Swift confirms.
      return;
    }
    setSnapshot(null); setMe(null); setNetworks(null);
    setScreen("login");
  };

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
  const profileFromIntent = (intent) => ({
    intentId: intent.id,
    intent: intent.title,
    edges: intent.edges,
    offLimits: intent.offLimits,
    shape: intent.shape || "warm",
  });
  const pickExistingIntent = (intent) => {
    setProfile(profileFromIntent(intent));
    setScreen("main");
    seedField();
  };
  const goOnboarding = () => setScreen("onboarding");
  const finishOnboarding = async (answers, created) => {
    setConversation([]);
    setField([]);
    setFreshUser(false);   // they've created a signal — hub is no longer empty

    // When the intent was created live, reload the snapshot and open the main
    // view on the freshly created signal (newest by createdAt).
    if (created && window.IndexApp && window.IndexApp.isAuthed()) {
      const snap = await window.IndexApp.loadSnapshot().catch(() => null);
      if (snap) {
        applyLoaded(snap);
        const intents = [...(snap.snapshot.INTENTS || [])].sort((a, b) => {
          const ta = a.source && a.source.createdAt ? Date.parse(a.source.createdAt) : 0;
          const tb = b.source && b.source.createdAt ? Date.parse(b.source.createdAt) : 0;
          return tb - ta;
        });
        if (intents[0]) {
          setProfile(profileFromIntent(intents[0]));
          setScreen("main");
          seedField();
          return;
        }
      }
    }

    setProfile({
      intent: answers.intent,
      edges: answers.edges,
      offLimits: answers["off-limits"],
      shape: answers.shape || "warm",
    });
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

  const startLogin = () => {
    freshLoginRef.current = true;
    if (window.IndexApp && window.IndexApp.login()) {
      // Native bridge present: wait for __indexAuthChanged; Login shows waiting.
      return true;
    }
    // No native bridge (browser preview) — drop into the demo flow.
    setScreen("building");
    return false;
  };

  return (
    <IndexDataContext.Provider value={{ data, me, networks, features, live }}>
      <div style={{
        position:"fixed", inset:0,
        overflow:"hidden",
      }} className="mac-desktop">
        {screen === "login"       && <Login onSignIn={startLogin}/>}
        {/* Boot loader: assembles the live snapshot, then opens the hub. */}
        {screen === "building"    && <BuildingProfile/>}
        {/* First run: review the profile we assembled, then into the hub.
            Declining returns to sign-in with nothing written, so the review
            replays on the next sign-in rather than being silently approved. */}
        {screen === "profile"     && <Settings
                                       initialTab="profile"
                                       profileOnly
                                       onClose={() => { freshLoginRef.current = false; signOut(); }}
                                       onDone={() => {
                                         freshLoginRef.current = false;
                                         if (!nativeAuthed()) setFreshUser(true);
                                         setScreen("intents");
                                       }}/>}
        {screen === "intents"     && <Intents
                                       fresh={freshUser}
                                       onPickExisting={pickExistingIntent}
                                       onNew={goOnboarding}
                                       onSignOut={signOut}/>}
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
    </IndexDataContext.Provider>
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
