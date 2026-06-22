// App — orchestrates screens & owns the simulation state

// Tweakable visibility — host can rewrite this block on disk
const TWEAK_DEFAULTS = /*EDITMODE-BEGIN*/{
  "showTopBar": true,
  "showBottomBar": true,
  "showConversationPane": true,
  "showMatchFeed": true,
  "showPipelineFunnel": true,
  "showModeBadge": true,
  "showFieldTicker": true,
  "showSourceBadges": true,
  "showAmbientNotes": true,
  "showPendingPill": true,
  "showMatchPitch": true,
  "showMatchSignals": true,
  "showMatchScore": true
}/*EDITMODE-END*/;

function App() {
  const { PEOPLE, POOL } = window.HALO_DATA;
  const [tweaks, setTweak] = useTweaks(TWEAK_DEFAULTS);
  const [screen, setScreen] = useState("landing"); // landing | onboarding | main
  const [profile, setProfile] = useState({});
  const [people, setPeople] = useState(() => [
    ...PEOPLE.map(p => ({ ...p, hidden: false })),
    ...POOL.map(p => ({ ...p, hidden: true })),
  ]);
  const [conversation, setConversation] = useState([]);
  const [field, setField] = useState([]);
  const [openRoomId, setOpenRoomId] = useState(null);
  const [simRate, setSimRate] = useState(1);

  // accumulating stats that look "alive"
  const [accStats, setAccStats] = useState({ inspected: 47, online: 62 });
  useInterval(() => {
    setAccStats(s => ({
      inspected: s.inspected + (Math.random() < 0.7 ? 1 : 0) + (Math.random() < 0.3 ? 1 : 0),
      online: s.online + (Math.random() < 0.5 ? 1 : -1),
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

  const goOnboarding = () => setScreen("onboarding");
  const finishOnboarding = (answers) => {
    setProfile({
      intent: answers.intent,
      edges: answers.edges,
      offLimits: answers["off-limits"],
      shape: answers.shape || "warm",
    });
    setScreen("main");
    // seed field with a few events
    setTimeout(() => {
      const seeds = window.HALO_DATA.FIELD_EVENTS.slice(0, 4).map(e => ({
        ...e, id: Math.random().toString(36).slice(2), t: Date.now(),
      }));
      setField(seeds);
    }, 400);
  };

  const openRoom = (id) => setOpenRoomId(id);
  const closeRoom = () => setOpenRoomId(null);
  const personById = (id) => people.find(p => p.id === id);

  const handleAction = (personId, action) => {
    setPeople(prev => prev.map(p => {
      if (p.id !== personId) return p;
      if (action === "accept") return { ...p, status: "accepted", score: Math.max(p.score, 0.96) };
      if (action === "pass") return { ...p, status: "passed" };
      if (action === "counter") return { ...p, status: "negotiating" };
      if (action === "wait") return p;
      return p;
    }));
    const labels = {
      accept: "intro accepted · your agent is reaching out now.",
      pass: "passed · their agent received it cleanly.",
      counter: "counter-propose sent · waiting on their move.",
      wait: "left it running. i'll keep going.",
    };
    setField(prev => [{ kind: "negotiate", text: labels[action] || "noted.", id: Math.random().toString(36).slice(2), t: Date.now() }, ...prev].slice(0, 50));
  };

  return (
    <>
      {screen === "landing" && <Landing onEnter={goOnboarding} />}
      {screen === "onboarding" && (
        <Onboarding onDone={finishOnboarding} onBack={() => setScreen("landing")} />
      )}
      {screen === "main" && (
        <MainView
          profile={profile}
          people={people}
          setPeople={setPeople}
          conversation={conversation}
          setConversation={setConversation}
          field={field}
          setField={setField}
          stats={stats}
          simRate={simRate}
          setSimRate={setSimRate}
          tweaks={tweaks}
        />
      )}

      {/* Tweaks panel — toggleable from toolbar. Lets you remove any area of the UI. */}
      <TweaksPanel title="halo · tweaks">
        <TweakSection label="Layout · remove areas" />
        <TweakToggle label="Top bar"          value={tweaks.showTopBar}          onChange={v => setTweak('showTopBar', v)} />
        <TweakToggle label="Bottom bar"       value={tweaks.showBottomBar}       onChange={v => setTweak('showBottomBar', v)} />
        <TweakToggle label="Left · feed"      value={tweaks.showConversationPane} onChange={v => setTweak('showConversationPane', v)} />
        <TweakToggle label="Right · pipeline" value={tweaks.showMatchFeed}        onChange={v => setTweak('showMatchFeed', v)} />

        <TweakSection label="Pipeline header" />
        <TweakToggle label="Pipeline funnel"  value={tweaks.showPipelineFunnel}  onChange={v => setTweak('showPipelineFunnel', v)} />
        <TweakToggle label="Mode badge"       value={tweaks.showModeBadge}       onChange={v => setTweak('showModeBadge', v)} />
        <TweakToggle label="Field ticker"     value={tweaks.showFieldTicker}     onChange={v => setTweak('showFieldTicker', v)} />

        <TweakSection label="Feed" />
        <TweakToggle label="Source badges"    value={tweaks.showSourceBadges}    onChange={v => setTweak('showSourceBadges', v)} />
        <TweakToggle label="Ambient notes"    value={tweaks.showAmbientNotes}    onChange={v => setTweak('showAmbientNotes', v)} />
        <TweakToggle label="'waiting on you'" value={tweaks.showPendingPill}     onChange={v => setTweak('showPendingPill', v)} />

        <TweakSection label="Match card" />
        <TweakToggle label="Agent pitch line" value={tweaks.showMatchPitch}      onChange={v => setTweak('showMatchPitch', v)} />
        <TweakToggle label="Signal chips"     value={tweaks.showMatchSignals}    onChange={v => setTweak('showMatchSignals', v)} />
        <TweakToggle label="Score bar"        value={tweaks.showMatchScore}      onChange={v => setTweak('showMatchScore', v)} />
      </TweaksPanel>
    </>
  );
}

ReactDOM.createRoot(document.getElementById("root")).render(<App />);
