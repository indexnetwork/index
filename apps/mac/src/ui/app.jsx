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
    chatUnread: 0,
  };
}

// Fictional, in the shape a real banner takes. Your agent sits on the left
// when the notice is from them, and that person's photo sits on the right.
// A message is from the sender, so their photo is the only avatar, on the
// left. An opportunity is titled "New possibility:" plus the person. A
// question is titled "Question from your agent".
const NOTIFY_PREVIEWS = [
  { title:"Question from your agent", body:"Have you flown anything past the atmosphere, or only ground tests? I need that before I look further." },
  { lead:"New possibility:", name:"Leah Okonkwo", body:"She's building a rocket ship and needs the guidance system you've already flown.", face:"leah" },
  { title:"Noah Ellis", body:"The tank weld lined up with the ship you're building. Sending the test notes.", face:"noah", from:"person" },
];

function saveNotifyPromptChoices() {
  const prev = (window.IndexApp && window.IndexApp.notifyPrefs && window.IndexApp.notifyPrefs()) || {};
  const toast = {
    ...prev,
    opportunity: true,
    accepted: true,
    messages: true,
  };
  if (window.IndexApp && window.IndexApp.setNotifyPrefs) window.IndexApp.setNotifyPrefs(toast);
  const me = window.INDEX_DATA && window.INDEX_DATA.ME;
  if (me) {
    me.notify = { ...(me.notify || {}), ...toast };
    me.notificationPreferences = { ...(me.notificationPreferences || {}), ...toast };
  }
  const client = window.IndexApp && window.IndexApp.getClient && window.IndexApp.getClient();
  if (client) client.auth.updateProfile({ notificationPreferences: toast }).catch(() => {});
}

const PREVIEW_FACES = {
  leah:"data:image/jpeg;base64,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",
  noah:"data:image/jpeg;base64,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",
};

function NotifyPreview({ lead, title, name, body, face, from }) {
  const thumb = face && PREVIEW_FACES[face];
  const fromAgent = from !== "person";
  return (
    <div style={{
      display:"grid", gridTemplateColumns:"auto minmax(0, 1fr) auto",
      gap:12, alignItems:"center",
      padding:"10px 12px",
      background:"#fff", color:"#000",
      border:"1px solid #000",
      boxShadow:"2px 2px 0 rgba(0,0,0,0.22)",
    }}>
      {fromAgent
        ? <AgentAvatar size={36} seed="index" title="your agent"/>
        : <img alt="" src={thumb} width={36} height={36} style={{ width:36, height:36, objectFit:"cover", display:"block" }}/>}
      <span style={{ display:"grid", gap:3, minWidth:0 }}>
        <span style={{
          display:"flex", alignItems:"baseline", gap:6, minWidth:0,
          fontFamily:"var(--mac-mono)", fontSize:13, fontWeight:700, color:"#000",
        }}>
          {lead && <span style={{ flex:"0 0 auto" }}>{lead}</span>}
          <span style={{ minWidth:0, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{name || title}</span>
        </span>
        {body && (
          <span style={{
            fontFamily:"var(--mac-sans)", fontSize:12, lineHeight:1.4, color:"var(--ink-2)",
          }}>{body}</span>
        )}
      </span>
      {fromAgent && thumb
        ? <img alt="" src={thumb} width={36} height={36} style={{ width:36, height:36, objectFit:"cover", display:"block" }}/>
        : <span style={{ width:36 }}/>}
    </div>
  );
}

// Shown while macOS has not been asked yet. Allow turns on the three toasts
// and raises the system dialog, which this screen stays behind until it is
// answered. Not now leaves the choice for later.
function NotifyPermissionInterstitial() {
  const app = window.IndexApp;
  const [open, setOpen] = useState(() => !!(app && app.notifyPrompt && app.notifyPrompt()));
  const [waiting, setWaiting] = useState(false);
  useEffect(() => {
    if (!app || !app.onNotifyPromptChanged) return;
    return app.onNotifyPromptChanged((next) => {
      setOpen(!!next);
      if (!next) setWaiting(false);
    });
  }, []);
  if (!open) return null;
  const allow = () => {
    if (waiting || !app || !app.notifyPromptReady) return;
    saveNotifyPromptChoices();
    setWaiting(true);
    app.notifyPromptReady();
  };
  const skip = () => {
    if (waiting || !app || !app.dismissNotifyPrompt) return;
    app.dismissNotifyPrompt();
  };
  return (
    <div className="mac-desktop" style={{ position:"fixed", inset:0, zIndex:950, display:"grid", placeItems:"center", padding:"56px 40px" }}>
      <MacWindow title="notifications" style={{ width:480, maxWidth:"100%" }}>
        <div style={{ padding:"22px 22px 18px" }}>
          <h1 style={{
            fontFamily:"var(--mac-mono)", fontWeight:600,
            fontSize:13, lineHeight:1.3, letterSpacing:0,
            margin:0, color:"#000",
          }}>don't miss the good ones.</h1>
          <p style={{
            margin:"8px 0 0",
            fontFamily:"var(--mac-sans)", fontSize:13, lineHeight:1.5, color:"var(--ink-2)",
          }}>
            index is always looking. this is how it reaches you.
          </p>
          <div style={{ display:"grid", gap:9, marginTop:14 }}>
            {NOTIFY_PREVIEWS.map((preview) => (
              <NotifyPreview key={preview.title || preview.name} {...preview}/>
            ))}
          </div>
          <div style={{ display:"flex", alignItems:"center", gap:14, marginTop:16 }}>
            <Btn primary disabled={waiting} onClick={allow}>
              {waiting ? "waiting for macos…" : "allow"}
            </Btn>
            {!waiting && (
              <button
                onClick={skip}
                style={{
                  border:"none", background:"none", padding:0, cursor:"pointer",
                  fontFamily:"var(--mac-sans)", fontSize:13, color:"#000",
                  textDecoration:"underline", textUnderlineOffset:3,
                }}>not now</button>
            )}
          </div>
        </div>
      </MacWindow>
    </div>
  );
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
// on the chat, and fall back to the conversations list when there is none.
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
    return person ? { person, intentId: via.intentId || null } : null;
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
  // Unread person-to-person threads. The conversations shelf shows this, and
  // the Dock badge adds it to the signal and network counts.
  const [chatUnread, setChatUnread] = useState(0);

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
      // A failed refresh keeps the list already on screen.
      if (!net || net.failed || !Array.isArray(net.networks)) return;
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
      if (!loaded || !loaded.snapshot || !loaded.intentsOk) return;
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
  // The screens the native menus can open: settings, networks, conversations
  // and negotiations (null = none, `tab` applies to settings only,
  // `conversationId` to conversations only). They live up here rather than in
  // the hub because Index ▸ Settings… and the View menu have to work from a
  // signal too, and they open over whatever is on screen so neither the hub nor
  // a live signal session is torn down to show them.
  const [overlay, setOverlay] = useState(null);
  const closeOverlay = () => setOverlay(null);
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
        if (ours) setNotice("that link doesn't open in the app. view it on index.network.");
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
      // A conversation that belongs to a signal on the hub opens on that
      // signal. Anything else still reads in the conversations list, with the
      // thread already open.
      if (link.route === "conversation") {
        const target = await resolveDeepLinkConversation(link, peopleRef.current);
        if (resolvingRef.current !== link) return;
        resolvingRef.current = null;
        const intent = target && findIntent(target.intentId);
        if (intent) {
          openIntentOn(intent, { kind: "chat", personId: target.person.id });
        } else {
          setOverlay({ view: "conversations", conversationId: link.id });
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

  // Dock tile: questions and opportunities waiting on a signal, plus the
  // shelf counts we can actually read (unread conversations, join requests).
  // The tile is a sum of the in-memory snapshot. That snapshot only reloaded
  // when the hub mounted or this app archived a signal, so a change made
  // anywhere else sat on the icon until the next relaunch.
  const overlayView = overlay && overlay.view;
  const refreshChatUnread = React.useCallback(() => {
    if (!live || !window.IndexApp || !window.IndexApp.getClient) {
      setChatUnread(0);
      return;
    }
    const client = window.IndexApp.getClient();
    if (!client || !client.conversations || !client.conversations.list) return;
    client.conversations.list()
      .then((res) => {
        const rows = window.IndexApp.normalizeList(res, "conversations");
        const n = rows.reduce((sum, c) => {
          const people = ((c && c.participants) || []).filter((p) => p && p.participantType === "user");
          if (people.length !== 2 || (c.participants || []).length !== 2) return sum;
          return sum + (Number(c.unreadCount) || 0);
        }, 0);
        setChatUnread(n);
      })
      .catch(() => {});
  }, [live]);
  useEffect(() => {
    refreshChatUnread();
  }, [refreshChatUnread, screen, overlayView]);
  useEffect(() => {
    if (!live) return;
    const t = setInterval(() => {
      refreshIntents();
      refreshNetworks();
      refreshChatUnread();
    }, 5000);
    return () => clearInterval(t);
  }, [live, refreshIntents, refreshNetworks, refreshChatUnread]);

  useEffect(() => {
    if (!window.IndexApp || !window.IndexApp.setDockBadge) return;
    if (!live) {
      window.IndexApp.setDockBadge(0);
      return;
    }
    const signals = (INTENTS || []).reduce((sum, intent) => {
      if (!intent || intent.status !== "active") return sum;
      return sum + (Number(intent.pending) || 0);
    }, 0);
    const joins = (networks || []).reduce((sum, net) => sum + (Number(net.pendingJoinCount) || 0), 0);
    window.IndexApp.setDockBadge(signals + joins + chatUnread);
  }, [live, INTENTS, networks, chatUnread]);

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
        setOverlay(null);
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
    <IndexDataContext.Provider value={{ data, me, networks, features, live, refreshNetworks, refreshIntents, patchIntentStatus, chatUnread }}>
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
                                         "almost there",
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
        {/* These lay over the desktop instead of replacing the screen, so
            leaving one drops you back into the same hub or signal. */}
        {overlay && (
          <div className="mac-desktop" style={{ position:"fixed", inset:0, zIndex:850 }}>
            {overlay.view === "settings" && <Settings initialTab={overlay.tab} onClose={closeOverlay}/>}
            {overlay.view === "networks" && (
              <Networks
                initialCreate={overlay.tab === "create"}
                onClose={closeOverlay}
                onNewSignal={() => { closeOverlay(); goNewIntent(); }}
                onOpenSignal={(sig) => {
                  const intent = (window.INDEX_DATA.INTENTS || []).find(s => s.id === sig.id);
                  closeOverlay();
                  if (intent) pickExistingIntent(intent);
                }}
              />
            )}
            {overlay.view === "conversations" && (
              <Conversations initialConversationId={overlay.conversationId} onClose={closeOverlay} onRead={refreshChatUnread}
                onNewSignal={() => { closeOverlay(); goNewIntent(); }}/>
            )}
            {overlay.view === "negotiations" && <NegotiationHistory onClose={closeOverlay}/>}
          </div>
        )}
        {notice && <MacNotice text={notice} onDismiss={() => setNotice(null)}/>}
        <NotifyPermissionInterstitial/>
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
