// App — orchestrates the Mac System 6 prototype.
// Same screen state machine as the original: landing → onboarding → main.

function App() {
  const { PEOPLE, POOL, FIELD_EVENTS } = window.HALO_DATA;
  const [screen, setScreen] = useState("landing");
  const [profile, setProfile] = useState({});
  const [people, setPeople] = useState(() => [
    ...PEOPLE.map(p => ({ ...p, hidden: false })),
    ...POOL.map(p => ({ ...p, hidden: true })),
  ]);
  const [conversation, setConversation] = useState([]);
  const [field, setField] = useState([]);
  const [simRate, setSimRate] = useState(1);

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

  const goOnboarding = () => setScreen("onboarding");
  const finishOnboarding = (answers) => {
    setProfile({
      intent: answers.intent,
      edges: answers.edges,
      offLimits: answers["off-limits"],
      shape: answers.shape || "warm",
    });
    setScreen("main");
    setTimeout(() => {
      const seeds = FIELD_EVENTS.slice(0, 4).map(e => ({
        ...e, id: Math.random().toString(36).slice(2), t: Date.now(),
      }));
      setField(seeds);
    }, 400);
  };

  return (
    <React.Fragment>
      {/* mac menubar — visible across screens */}
      <MacMenubar screen={screen}/>

      <div style={{
        position:"fixed", inset:"20px 0 0 0",
        overflow:"hidden",
      }} className="mac-desktop">
        {screen === "landing"     && <Landing onEnter={goOnboarding}/>}
        {screen === "onboarding"  && <Onboarding onDone={finishOnboarding} onBack={() => setScreen("landing")}/>}
        {screen === "main"        && (
          <MainView
            profile={profile}
            people={people} setPeople={setPeople}
            conversation={conversation} setConversation={setConversation}
            field={field} setField={setField}
            stats={stats}
            simRate={simRate} setSimRate={setSimRate}
          />
        )}
      </div>
    </React.Fragment>
  );
}

function MacMenubar({ screen }) {
  const [clock, setClock] = useState(macClock());
  useEffect(() => {
    const t = setInterval(() => setClock(macClock()), 30000);
    return () => clearInterval(t);
  }, []);
  return (
    <div className="mac-menubar">
      <span className="m apple"></span>
      <span className="m bold">File</span>
      <span className="m">Edit</span>
      <span className="m">View</span>
      <span className="m">Special</span>
      <span className="m">halo</span>
      <span className="right">
        <span className="m subtle">
          { screen === "landing"    ? "Welcome to halo"
          : screen === "onboarding" ? "halo · calibrating"
          : "halo · always on" }
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
