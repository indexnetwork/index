// App, orchestrates the Mac System 6 prototype against the live backend.
// Auth source of truth is a credential-free boolean surfaced by the native
// Keychain owner. Requests cross the structured native bridge. When signed out
// the app shows sign-in; INDEX_DATA is only a signed-out demo
// fallback for browser preview where the Swift bridge is absent.

// Live-only: there is no static demo data. window.INDEX_DATA starts empty and is
// filled with the signed-in user's ME/NETWORKS/INTENTS by applyLoaded once the
// snapshot loads; side screens (settings/networks) read that live mirror.
window.INDEX_DATA = window.INDEX_DATA || {};

// Live data (mapped snapshot + ME/NETWORKS) is threaded through this context so
// screens can read it; everything is empty until the snapshot loads.
const IndexDataContext = React.createContext(null);
function useIndexData() {
  const ctx = React.useContext(IndexDataContext);
  return (ctx && ctx.data) || window.INDEX_DATA;
}
function useIndexEnv() {
  return React.useContext(IndexDataContext) || {
    data: window.INDEX_DATA, me: null, networks: null, features: {}, live: false,
    refreshNetworks: () => {},
    refreshIntents: () => {},
    patchIntentStatus: () => {},
  };
}

function nativeAuthed() {
  return !!(window.IndexApp && window.IndexApp.isAuthed());
}

// Resolve a parsed deep link (see api/deeplink.mjs) to a person card. A card
// link carries an opportunity id, a profile link a user id, so each is looked
// up against the loaded radar first. Anything this snapshot does not carry
// gets one fetch by id through the existing client methods, and null when even
// that comes up empty, so the caller can say so instead of opening a blank
// window.
// A conversation link (minted by the app's own OS toasts) names a thread
// rather than a person card. Its provenance carries both the signal the thread
// belongs to and the opportunity behind it, so the caller can open that signal
// on the chat, and fall back to a floating chat with a name and face when the
// signal is no longer on the hub.
async function resolveDeepLinkConversation(route, people) {
  if (!nativeAuthed() || !window.IndexApp) return null;
  const client = window.IndexApp.getClient();
  if (!client) return null;
  try {
    const res = await client.conversations.list();
    const conv = window.IndexApp.normalizeList(res, "conversations").find((row) => row && row.id === route.id);
    const via = conv && Array.isArray(conv.via) ? conv.via[0] : null;
    if (!via) return null;
    const person = await resolveDeepLinkPerson({ route: "card", id: via.opportunityId }, people);
    return person
      ? { person, conversationId: route.id, intentId: via.intentId || null }
      : null;
  } catch (e) {
    return null;
  }
}

async function resolveDeepLinkPerson(route, people) {
  const known = route.route === "card"
    ? people.find(p => p.id === route.id)
    : people.find(p => p.userId === route.id);
  if (known) return known;

  if (!nativeAuthed() || !window.IndexApp) return null;
  const client = window.IndexApp.getClient();
  if (!client) return null;
  try {
    if (route.route === "card") {
      const res = await client.opportunities.get(route.id);
      const row = (res && res.opportunity) || res;
      if (!row || !row.id) return null;
      const person = window.IndexApi.mapPeopleFromOpportunities([row])[0] || null;
      // GET /opportunities/:id names the counterpart under otherParties rather
      // than the counterpartUserId/counterpartName the list mapper reads, and
      // the profile needs the user id to fetch their bio. `intentId` is the
      // viewer's own signal, which is what decides between opening that signal
      // and floating a card.
      const other = Array.isArray(row.otherParties) ? row.otherParties[0] : null;
      if (person) person.intentId = row.intentId || null;
      if (person && other) {
        person.userId = person.userId || other.id || null;
        person.name = other.name || person.name;
        person.photo = person.photo || other.avatar || null;
      }
      return person;
    }
    const res = await client.users.get(route.id);
    const user = (res && res.user) || res;
    if (!user || !user.id) return null;
    return {
      id: user.id,
      userId: user.id,
      name: user.name || "unknown",
      location: user.location || "",
      ...window.IndexApi.mapCounterpartProfile(user),
    };
  } catch (e) {
    return null;
  }
}

function App() {
  const [screen, setScreen] = useState(() => nativeAuthed() ? "building" : "login");
  // True until the user creates their first signal, the hub opens empty.
  const [freshUser, setFreshUser] = useState(false);
  const [profile, setProfile] = useState({});
  // First run, in order: the name confirmed on the card, then what the
  // public-research lookup made of it. Both feed the getting-started review.
  const [confirmedName, setConfirmedName] = useState("");
  const [enriched, setEnriched] = useState(null);
  // Live snapshot state; null until loadSnapshot() resolves (or in demo mode).
  const [snapshot, setSnapshot] = useState(null);
  const [me, setMe] = useState(null);
  const [networks, setNetworks] = useState(null);
  const [features, setFeatures] = useState({});
  const live = snapshot !== null;
  const data = snapshot || {};
  const { PEOPLE = [], POOL = [], FIELD_EVENTS = [], INTENTS = [] } = data;

  const refreshNetworks = React.useCallback(async () => {
    if (!nativeAuthed() || !window.IndexApp) return;
    try {
      let net = null;
      if (window.IndexApp.loadNetworks) {
        net = await window.IndexApp.loadNetworks();
      } else {
        const c = window.IndexApp.getClient && window.IndexApp.getClient();
        if (!c) return;
        const [listR] = await Promise.all([
          c.networks.list().catch(() => null),
          c.auth.me().catch(() => null),
        ]);
        if (!listR) return;
        const raw = window.IndexApp.normalizeList(listR, "networks");
        net = {
          networks: window.IndexApp.mapDiscoverNetworks
            ? raw.map((n) => window.IndexApp.mapDiscoverNetworks([{ ...n, isMember: true }])[0])
            : raw.map((n) => ({ id: n.id, name: n.title || n.name || "untitled", joined: true })),
        };
      }
      if (!net || !Array.isArray(net.networks)) return;
      setNetworks(net.networks);
      Object.assign(window.INDEX_DATA, { NETWORKS: net.networks });
    } catch (e) { /* keep prior list */ }
  }, []);

  // Re-fetch the signal shelf after pause/archive (or whenever the hub remounts)
  // so row status matches the backend without a full app reload.
  const refreshIntents = React.useCallback(async () => {
    if (!nativeAuthed() || !window.IndexApp) return;
    try {
      const loaded = await window.IndexApp.loadSnapshot();
      if (!loaded || !loaded.snapshot) return;
      const intents = loaded.snapshot.INTENTS || [];
      setSnapshot((prev) => (prev ? { ...prev, INTENTS: intents } : loaded.snapshot));
      Object.assign(window.INDEX_DATA, { INTENTS: intents });
    } catch (e) { /* keep prior list */ }
  }, []);

  // Optimistic shelf update after pause/archive lands locally, before refresh.
  const patchIntentStatus = React.useCallback((intentId, nextStatus) => {
    const apply = window.IndexApi && window.IndexApi.applyMappedIntentStatus;
    if (!apply || !intentId) return;
    setSnapshot((prev) => {
      if (!prev || !Array.isArray(prev.INTENTS)) return prev;
      const INTENTS = apply(prev.INTENTS, intentId, nextStatus);
      if (INTENTS === prev.INTENTS) return prev;
      Object.assign(window.INDEX_DATA, { INTENTS });
      return { ...prev, INTENTS };
    });
  }, []);
  const [people, setPeople] = useState([]);
  const [conversation, setConversation] = useState([]);
  const [field, setField] = useState([]);
  const [simRate, setSimRate] = useState(1);

  // ---- deep links (index:// and universal links) --------------------------
  // Swift forwards the raw URL it was handed and decides nothing about it;
  // window.IndexApi.parseDeepLink (apps/mac/api/deeplink.mjs, unit tested) is
  // the only place a URL turns into a route.
  const [notice, setNotice] = useState(null);
  const [pendingLink, setPendingLink] = useState(null);   // parsed route, not applied yet
  const [linkedCard, setLinkedCard] = useState(null);     // { person, route } on screen
  const [linkedChat, setLinkedChat] = useState(null);     // { person, conversationId } on screen
  // Bumped when a question link lands, so the signal's feed scrolls to it even
  // if that signal was already open and nothing else changed.
  const [focusQuestion, setFocusQuestion] = useState(0);

  useEffect(() => {
    if (!window.IndexApp || !window.IndexApp.onDeepLink) return;
    return window.IndexApp.onDeepLink((url) => {
      const deepLinkHosts = Array.isArray(window.INDEX_NATIVE?.deepLinkHosts)
        && window.INDEX_NATIVE.deepLinkHosts.length
        ? { hosts: window.INDEX_NATIVE.deepLinkHosts }
        : undefined;
      const route = (window.IndexApi && window.IndexApi.parseDeepLink)
        ? window.IndexApi.parseDeepLink(url, deepLinkHosts)
        : null;
      if (!route) {
        // Not ours: stay quiet. Direct or manual invocation can still provide
        // a recognized-host URL the app cannot route; AASA excludes deeper
        // web-only profile paths before normal macOS delivery.
        const ours = (window.IndexApi && window.IndexApi.isIndexDeepLink)
          ? window.IndexApi.isIndexDeepLink(url, deepLinkHosts)
          : false;
        if (ours) setNotice("that link doesn't open in the app — view it on index.network.");
        return;
      }
      if (route.route === "legacy-connect") {
        // Connect links were retired; there is nothing left to resolve them to.
        setNotice("this link is no longer supported — open the opportunity from your radar.");
        return;
      }
      setPendingLink(route);
    });
  }, []);

  // The resolver reads the radar through a ref, and a link already in flight is
  // never started twice. Depending on `people` (or restarting on a screen
  // change) would cancel and re-issue the fallback fetch on every radar update:
  // a duplicate GET /opportunities/:id at best, and in demo mode the periodic
  // sim tick could keep restarting it so the link never lands on a card or a
  // notice at all. One pending link resolves once, and always terminates.
  const peopleRef = useRef(people);
  peopleRef.current = people;
  const resolvingRef = useRef(null);

  // A link can arrive at the login screen or mid-boot (cold launch is the
  // normal case). Hold it there and apply it once the snapshot is in, rather
  // than resolving it against data that hasn't loaded.
  useEffect(() => {
    if (!pendingLink || screen === "login" || screen === "building") return;
    if (resolvingRef.current === pendingLink) return;   // already resolving this one
    const link = pendingLink;
    resolvingRef.current = link;
    (async () => {
      // A conversation belongs to a signal, so open that signal on the thread.
      // The floating chat is what is left when the signal is gone: the thread
      // still reads, it just has no session to live in.
      if (link.route === "conversation") {
        const target = await resolveDeepLinkConversation(link, peopleRef.current);
        if (resolvingRef.current !== link) return;
        resolvingRef.current = null;
        const intent = target && findIntent(target.intentId);
        if (intent) {
          openIntentOn(intent, { kind: "chat", personId: target.person.id });
        } else if (target) {
          setLinkedChat(target);
        } else {
          setNotice("couldn't open that conversation.");
        }
        setPendingLink(null);
        return;
      }
      // A question names its signal directly: it is answered in that signal's
      // own conversation with its agent, and nowhere else.
      if (link.route === "signal") {
        const intent = findIntent(link.id);
        resolvingRef.current = null;
        if (intent) {
          pickExistingIntent(intent);
          setFocusQuestion(Date.now());
        } else {
          setNotice("that signal isn't on your hub.");
        }
        setPendingLink(null);
        return;
      }
      const person = await resolveDeepLinkPerson(link, peopleRef.current);
      // A newer link arrived mid-flight and owns the slot now; let it finish.
      if (resolvingRef.current !== link) return;
      resolvingRef.current = null;
      // An opportunity is read inside the signal that surfaced it. A profile
      // link names no signal at all, so it stays a floating card, as does an
      // opportunity whose signal has left the hub.
      const owner = link.route === "card" && person ? findIntent(person.intentId) : null;
      if (owner) {
        openIntentOn(owner, { kind: "profile", personId: person.id, status: person.status });
      } else if (person) {
        setLinkedCard({ person, route: link.route });
      } else {
        setNotice(link.route === "card"
          ? "that opportunity isn't on your radar."
          : "couldn't open that profile.");
      }
      setPendingLink(null);
    })();
  }, [pendingLink, screen]);

  // Desktop notification pipeline: runs app-wide while signed in. The native
  // side never toasts while the app is frontmost, so this can stay up across
  // every screen; the identity gate (own-message suppression) rides on me.id.
  const meId = me && me.id;
  useEffect(() => {
    if (!live || !meId || !window.IndexApp || !window.IndexApp.startDesktopNotifications) return;
    return window.IndexApp.startDesktopNotifications({ getUserId: () => meId });
  }, [live, meId]);

  // React to native login/logout coming from the Swift shell.
  useEffect(() => {
    if (!window.IndexApp) return;
    // Reload can finish (and set INDEX_NATIVE.authenticated) before this
    // subscriber is attached. Re-read so a signed-in Reload does not stick
    // on the login screen from a stale document-start snapshot.
    if (nativeAuthed()) setScreen("building");
    return window.IndexApp.onAuthChanged((authenticated) => {
      if (authenticated) {
        setScreen("building");
      } else {
        setSnapshot(null); setMe(null); setNetworks(null);
        setConfirmedName(""); setEnriched(null);
        Object.assign(window.INDEX_DATA, { NETWORKS: [] });
        // Drop the whole deep-link pipeline, not just what is on screen: a
        // resolve still in flight would otherwise render a counterpart's card
        // over the login screen. Clearing resolvingRef makes the in-flight
        // resolve fail its own ownership check and bail when it completes.
        setLinkedCard(null);
        setLinkedChat(null);
        setPendingLink(null);
        resolvingRef.current = null;
        setScreen("login");
      }
    });
  }, []);

  // The "building" screen doubles as the boot loader: fetch the live snapshot,
  // then drop into the signals hub. Falls back to demo data when unauthenticated.
  // Two GETs and no artificial floor: the real wait at first run is the lookup
  // after the name card, and padding this one only made the same window appear
  // twice in a few seconds.
  useEffect(() => {
    if (screen !== "building") return;
    let cancelled = false;
    (async () => {
      let loaded = null;
      if (nativeAuthed() && window.IndexApp) {
        loaded = await window.IndexApp.loadSnapshot().catch(() => null);
      }
      if (cancelled) return;
      let needsProfile = false;
      if (loaded) {
        applyLoaded(loaded);
        setFreshUser((loaded.snapshot.INTENTS || []).length === 0);
        // Durable gate: a user who hasn't confirmed their profile yet reviews it
        // now, whether this is a fresh sign-in or a relaunch mid-onboarding.
        const ob = loaded.raw && loaded.raw.user && loaded.raw.user.onboarding;
        needsProfile = !(ob && ob.profileConfirmedAt);
        // Networks load in parallel with the loader animation; no cancelled guard
        // here — the building effect cleanup would discard the update otherwise.
        refreshNetworks();
      }
      setScreen(needsProfile ? "name" : "intents");
    })();
    return () => { cancelled = true; };
  }, [screen, refreshNetworks]);

  // First run, behind the same loader window: the public-research lookup, run on
  // the name just confirmed rather than on whatever the handshake happened to
  // supply. Nothing found is not a failure, the review just opens empty.
  useEffect(() => {
    if (screen !== "looking-up") return;
    let cancelled = false;
    (async () => {
      const res = (nativeAuthed() && window.IndexApp && window.IndexApp.triggerEnrichment)
        ? await window.IndexApp.triggerEnrichment({ name: confirmedName }).catch(() => null)
        : null;
      if (cancelled) return;
      setEnriched(res);
      setScreen("onboarding");
    })();
    return () => { cancelled = true; };
  }, [screen, confirmedName]);

  // Fold a loaded snapshot into React state and mirror ME/NETWORKS/INTENTS onto
  // window.INDEX_DATA so the side screens (settings/networks) that still read it
  // directly show live data without prop threading.
  const applyLoaded = (loaded) => {
    setSnapshot(loaded.snapshot);
    setMe(loaded.me);
    setFeatures(loaded.features || {});
    setPeople([
      ...(loaded.snapshot.PEOPLE || []).map(p => ({ ...p, hidden: false })),
      ...(loaded.snapshot.POOL || []).map(p => ({ ...p, hidden: true })),
    ]);
    Object.assign(window.INDEX_DATA, {
      ME: loaded.me,
      INTENTS: loaded.snapshot.INTENTS || [],
    });
  };

  const signOut = () => {
    if (window.IndexApp && window.IndexApp.logout()) {
      // onAuthChanged will reset the UI once Swift confirms.
      return;
    }
    setSnapshot(null); setMe(null); setNetworks(null);
    setConfirmedName(""); setEnriched(null);
    Object.assign(window.INDEX_DATA, { NETWORKS: [] });
    setScreen("login");
  };

  // Bridge: MainView publishes its chats (per active signal) up here so the top
  // menubar can show a 2-step menu, signals, and the chats within each, and
  // it persists across screens (so it works from the landing screen too).
  const [chatGroups, setChatGroups] = useState({}); // signalTitle -> [{id,name,unread}]
  const chatOpenRef = useRef(null);                  // { signal, open } for the active session
  // What to open inside a signal once it mounts: { kind: "chat" | "profile",
  // personId, status }. The menubar resumes a signal on a chat; a deep link can
  // also land on a profile, and carries the status so the radar opens on the
  // stage that person is actually in.
  const [pendingFocus, setPendingFocus] = useState(null);
  const registerChats = (signal, list, openFn) => {
    if (!signal) return;
    setChatGroups(prev => ({ ...prev, [signal]: list }));
    chatOpenRef.current = { signal, open: openFn };
  };

  // The screens the native menus can open: settings, networks and negotiations
  // (null = none, `tab` applies to settings only). They live up here rather than
  // in the hub because Index ▸ Settings… and the View menu have to work from a
  // signal too, and they open over whatever is on screen so neither the hub nor
  // a live signal session is torn down to show them.
  const [overlay, setOverlay] = useState(null);
  const closeOverlay = () => setOverlay(null);
  // Index ▸ Settings… and the View menu call this. Before the hub there is no
  // account behind the screen, which is also why those items are dimmed there.
  useEffect(() => {
    const reachable = screen === "intents" || screen === "main";
    window.__indexOpenView = (view) => { if (reachable) setOverlay({ view, tab: "profile" }); };
    return () => { delete window.__indexOpenView; };
  }, [screen]);

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
    status: intent.status,
  });
  const pickExistingIntent = (intent) => {
    // App-level feeds persist across signals; clear them so the previous
    // signal's questions and radar never flash into the next open.
    setConversation([]);
    setField([]);
    setPeople([]);
    setProfile(profileFromIntent(intent));
    setScreen("main");
    seedField();
  };
  const findIntent = (id) => (id ? (INTENTS || []).find((i) => i.id === id) || null : null);
  // Resume a signal and say what to open inside it once the session mounts.
  const openIntentOn = (intent, focus) => { pickExistingIntent(intent); setPendingFocus(focus); };
  const goNewIntent = () => setScreen("new-intent");
  const finishNewIntent = async (answers, created, intentId) => {
    setConversation([]);
    setField([]);
    setPeople([]);
    setFreshUser(false);   // they've created a signal, hub is no longer empty

    // Open the exact persisted signal as soon as POST /intents returns its ID.
    // The shelf refresh is background work, not a second blocking
    // /auth/me + /intents/list bootstrap.
    if (created && intentId) {
      const now = new Date().toISOString();
      const optimistic = {
        id: intentId,
        title: answers.intent || "new signal",
        status: "active",
        source: { id:intentId, createdAt:now, updatedAt:now },
      };
      setSnapshot((current) => {
        const INTENTS = [optimistic, ...((current && current.INTENTS) || []).filter((intent) => intent.id !== intentId)];
        Object.assign(window.INDEX_DATA, { INTENTS });
        return current ? { ...current, INTENTS } : { INTENTS };
      });
      setProfile(profileFromIntent(optimistic));
      setScreen("main");
      seedField();
      void refreshIntents();
      if (window.IndexApp && window.IndexApp.completeOnboarding) {
        void window.IndexApp.completeOnboarding(intentId).catch(() => {});
      }
      return;
    }

    setProfile({ intent: answers.intent });
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
      if (intent) openIntentOn(intent, { kind: "chat", personId });
    }
  };

  const startLogin = () => {
    if (window.IndexApp && window.IndexApp.login()) {
      // Native bridge present: wait for __indexAuthChanged; Login shows waiting.
      return true;
    }
    // No native bridge (browser preview): live-only, so there is nothing to
    // show without a real session. Stay on the sign-in screen.
    return false;
  };

  return (
    <IndexDataContext.Provider value={{ data, me, networks, features, live, refreshNetworks, refreshIntents, patchIntentStatus }}>
      <div style={{
        position:"fixed", inset:0,
        overflow:"hidden",
      }} className="mac-desktop">
        {screen === "login"       && <Login onSignIn={startLogin}/>}
        {/* Boot loader: assembles the live snapshot, then opens the hub. */}
        {screen === "building"    && <BuildingProfile/>}
        {screen === "intents"     && <Intents
                                       fresh={freshUser}
                                       onPickExisting={pickExistingIntent}
                                       onNew={goNewIntent}
                                       onOpenView={(view, tab) => setOverlay({ view, tab })}
                                       onSignOut={signOut}/>}
        {screen === "new-intent"  && <NewIntent onDone={finishNewIntent} onBack={() => setScreen("intents")}/>}
        {/* First run, in three screens: confirm the name, look the person up
            behind the loader, then review what came back. The review is what
            PATCHes profile + confirm-profile; the first signal after it POSTs
            onboarding/complete. */}
        {screen === "name"        && <AskName
                                       initialName={(me && me.name) || ""}
                                       onSubmit={(name) => { setConfirmedName(name); setScreen("looking-up"); }}
                                       onSignOut={signOut}/>}
        {screen === "looking-up"  && <BuildingProfile
                                       title="looking you up"
                                       lines={[
                                         "looking you up…",
                                         "reading what's already public…",
                                         "almost there.",
                                       ]}/>}
        {screen === "onboarding"  && <Settings
                                       initialTab="profile"
                                       profileOnly
                                       firstRun
                                       enriched={enriched}
                                       name={confirmedName}
                                       onClose={signOut}
                                       onDone={() => { setFreshUser((INTENTS || []).length === 0); setScreen("new-intent"); }}/>}
        {/* A deep-linked card floats over whatever screen is showing: the link
            can land on the hub, where the radar's selection state doesn't
            exist. */}
        {linkedCard && (
          <DeepLinkWindow
            person={linkedCard.person}
            route={linkedCard.route}
            onClose={() => setLinkedCard(null)}
          />
        )}
        {linkedChat && (
          <DeepLinkChatWindow
            person={linkedChat.person}
            conversationId={linkedChat.conversationId}
            onClose={() => setLinkedChat(null)}
          />
        )}
        {/* These lay over the desktop instead of replacing the screen, so
            leaving one drops you back into the same hub or signal. */}
        {overlay && (
          <div className="mac-desktop" style={{ position:"fixed", inset:0, zIndex:850 }}>
            {overlay.view === "settings" && <Settings initialTab={overlay.tab} onClose={closeOverlay}/>}
            {overlay.view === "networks" && (
              <Networks
                onClose={closeOverlay}
                onOpenSignal={(sig) => {
                  const intent = (window.INDEX_DATA.INTENTS || []).find(s => s.id === sig.id);
                  closeOverlay();
                  if (intent) pickExistingIntent(intent);
                }}
              />
            )}
            {overlay.view === "negotiations" && <NegotiationHistory onClose={closeOverlay}/>}
          </div>
        )}
        {notice && <MacNotice text={notice} onDismiss={() => setNotice(null)}/>}
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
            pendingFocus={pendingFocus}
            onPendingHandled={() => setPendingFocus(null)}
            focusQuestion={focusQuestion}
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
          { screen === "intents"    ? "your signals"
          : screen === "new-intent" ? "calibrating"
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
