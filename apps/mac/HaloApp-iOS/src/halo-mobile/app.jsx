// App — mobile shell. Same simplified flow as the desktop build
// (signals hub → main), wrapped in phone chrome: a thin
// status bar up top, each screen filling the rest. The main screen brings its
// own bottom tab bar.

function App() {
  const { PEOPLE, POOL, FIELD_EVENTS, INTENTS } = window.HALO_DATA;
  const [screen, setScreen] = useState("intents");
  const [profile, setProfile] = useState({});
  const [people, setPeople] = useState(() => [
    ...PEOPLE.map(p => ({ ...p, hidden: false })),
    ...POOL.map(p => ({ ...p, hidden: true })),
  ]);
  const [conversation, setConversation] = useState([]);
  const [field, setField] = useState([]);
  const [simRate, setSimRate] = useState(1);

  const seedField = () => {
    setTimeout(() => {
      const seeds = FIELD_EVENTS.slice(0, 4).map(e => ({ ...e, id: Math.random().toString(36).slice(2), t: Date.now() }));
      setField(seeds);
    }, 400);
  };

  const pickExistingIntent = (intent) => {
    setProfile({ intent: intent.title, edges: intent.edges, offLimits: intent.offLimits, shape: intent.shape || "warm" });
    setScreen("main");
    seedField();
  };
  const startFreshSignal = () => {
    setProfile({ intent: "new signal", edges: "open context", offLimits: "", shape: "warm" });
    setConversation([]);
    setField([]);
    setScreen("main");
    seedField();
  };

  const status =
      screen === "intents"    ? "your signals"
    : "always on";

  return (
    <div className="mob-frame">
      <MobileTopBar status={status}/>
      <div className="mob-content">
        {screen === "intents"    && <Intents onPickExisting={pickExistingIntent} onNew={startFreshSignal}/>}
        {screen === "main"       && (
          <MainView
            profile={profile}
            people={people} setPeople={setPeople}
            conversation={conversation} setConversation={setConversation}
            field={field} setField={setField}
            simRate={simRate} setSimRate={setSimRate}
            onBack={() => setScreen("intents")}
          />
        )}
      </div>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById("root")).render(<App/>);
