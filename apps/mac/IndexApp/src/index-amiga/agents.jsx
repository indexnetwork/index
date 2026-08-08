/* global myAgent, setMyAgentFace, currentMe */
// One Personal Agent, with a durable Index-versus-Hermes execution binding.
// Server state decides who may pick up negotiations; the native bridge owns
// generation-fenced local Hermes wiring. Identity and policy never branch on
// the selected runtime.

const NEGOTIATOR_RUNTIME_OPTIONS = [
  { id:"index", label:"Index · system default" },
  { id:"hermes", label:"Hermes · on this Mac" },
];
const RUNTIME_STATE_LABELS = {
  index:"Index · system default",
  connecting:"Hermes · connecting",
  active:"Hermes · active",
  unavailable:"Hermes · unavailable — Index is covering",
  "needs-attention":"Hermes · needs attention",
};

function freshSetupAttemptId() {
  if (crypto.randomUUID) return crypto.randomUUID();
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, value => value.toString(16).padStart(2, "0"));
  return `${hex.slice(0, 4).join("")}-${hex.slice(4, 6).join("")}-${hex.slice(6, 8).join("")}-${hex.slice(8, 10).join("")}-${hex.slice(10).join("")}`;
}

// The face, name, memory/history navigation, and policy statement are one
// stable Personal Agent surface. Runtime state is intentionally not a prop.
function NegotiatorProfile({ agent, onShuffle, onOpenMemory, onOpenHistory }) {
  const btn = {
    fontFamily:"var(--mac-mono)", fontSize:11, padding:"5px 12px",
    border:"1px solid #000", background:"#fff", color:"#000",
    boxShadow:"1px 1px 0 rgba(0,0,0,0.2)", cursor:"pointer",
  };
  return (
    <div style={{ display:"grid", gap:12 }}>
      <RuleLabel size={13}>your Personal Agent</RuleLabel>
      <p style={{
        margin:0, maxWidth:620,
        fontFamily:"var(--mac-sans)", fontSize:12, lineHeight:1.5, color:"var(--ink-2)",
      }}>
        memory and history stay with this Personal Agent when its runtime changes.
      </p>
      <div style={{ display:"flex", alignItems:"center", gap:14, flexWrap:"wrap" }}>
        <MyAgentAvatar size={54}/>
        <div style={{ display:"grid", gap:6, minWidth:0 }}>
          <div style={{
            fontFamily:"var(--mac-mono)", fontSize:17, fontWeight:700, color:"#000",
          }}>{agent.name}</div>
          <div style={{ display:"flex", alignItems:"center", gap:9, flexWrap:"wrap" }}>
            <button style={btn} onClick={onShuffle}>⟳ shuffle</button>
            <span style={{ fontFamily:"var(--mac-mono)", fontSize:11, color:"var(--ink-2)" }}>
              authority: negotiations only
            </span>
          </div>
        </div>
      </div>
      <nav aria-label="Personal Agent memory and history" style={{ display:"flex", gap:8, flexWrap:"wrap" }}>
        <button style={btn} onClick={onOpenMemory}>profile & memory</button>
        <button style={btn} onClick={onOpenHistory}>negotiation history</button>
      </nav>
      <p style={{
        margin:0, maxWidth:620,
        fontFamily:"var(--mac-sans)", fontSize:12, lineHeight:1.5, color:"var(--ink-2)",
      }}>
        policy: negotiate within your active signals and ask before owner-only decisions;
        runtime changes never expand this authority.
      </p>
    </div>
  );
}

function RuntimeStatus({ runtimeView, busy, onRetry, onDisconnect }) {
  const dotColor = runtimeView.visualState === "active"
    ? "#1FA95B"
    : runtimeView.visualState === "needs-attention"
      ? "var(--ink-warn)"
      : runtimeView.visualState === "unavailable"
        ? "#D17B00"
        : "var(--ink-3)";
  const button = {
    fontFamily:"var(--mac-mono)", fontSize:11, padding:"5px 12px",
    border:"1px solid #000", background:"#fff",
    boxShadow:"1px 1px 0 rgba(0,0,0,0.2)", cursor:busy ? "default" : "pointer",
    opacity:busy ? 0.55 : 1,
  };
  return (
    <div
      role="status"
      aria-live="polite"
      aria-atomic="true"
      style={{
        display:"grid", gap:9, padding:"11px 12px", marginTop:9,
        border:"1px solid #000", background:"#F2F0EC",
      }}>
      <div style={{ display:"flex", alignItems:"center", gap:7 }}>
        <span aria-hidden="true" style={{ width:7, height:7, background:dotColor }}/>
        <strong style={{ fontFamily:"var(--mac-mono)", fontSize:12 }}>
          {RUNTIME_STATE_LABELS[runtimeView.visualState]}
        </strong>
      </div>
      <span style={{ fontFamily:"var(--mac-sans)", fontSize:12, lineHeight:1.5, color:"var(--ink-2)" }}>
        {runtimeView.statusLine}
      </span>
      {(runtimeView.canRetry || runtimeView.canDisconnect) && (
        <div style={{ display:"flex", gap:8, flexWrap:"wrap" }}>
          {runtimeView.canRetry && (
            <button disabled={busy} style={{ ...button, color:"#000" }} onClick={onRetry}>retry</button>
          )}
          {runtimeView.canDisconnect && (
            <button disabled={busy} style={{ ...button, color:"var(--ink-warn)" }} onClick={onDisconnect}>
              disconnect Hermes
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function NegotiatorSelect({ value, onChange, disabled }) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (event) => {
      if (wrapRef.current && !wrapRef.current.contains(event.target)) setOpen(false);
    };
    const onKey = (event) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      setOpen(false);
    };
    document.addEventListener("mousedown", onDown, true);
    document.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("mousedown", onDown, true);
      document.removeEventListener("keydown", onKey, true);
    };
  }, [open]);

  const current = NEGOTIATOR_RUNTIME_OPTIONS.find(option => option.id === value)
    || NEGOTIATOR_RUNTIME_OPTIONS[0];
  return (
    <div ref={wrapRef} style={{ position:"relative", maxWidth:380 }}>
      <button
        disabled={disabled}
        onClick={() => setOpen(value => !value)}
        aria-haspopup="listbox"
        aria-expanded={open}
        style={{
          display:"flex", alignItems:"center", gap:10, width:"100%",
          padding:"8px 11px", textAlign:"left", cursor:disabled ? "default" : "pointer",
          border:"1px solid #000", background:open ? "#F2EFE6" : "#fff",
          boxShadow:"1px 1px 0 rgba(0,0,0,0.2)", opacity:disabled ? 0.55 : 1,
        }}>
        <span style={{
          flex:1, minWidth:0,
          fontFamily:"var(--mac-mono)", fontSize:13, fontWeight:700, color:"#000",
        }}>{current.label}</span>
        <span aria-hidden="true" style={{ fontFamily:"var(--mac-mono)", fontSize:12 }}>▾</span>
      </button>
      {open && !disabled && (
        <div role="listbox" className="fade-up" style={{
          position:"absolute", top:"calc(100% + 4px)", left:0, zIndex:40,
          width:"100%", padding:"4px 0", background:"#fff",
          border:"1px solid #000", boxShadow:"3px 3px 0 rgba(0,0,0,0.22)",
        }}>
          {NEGOTIATOR_RUNTIME_OPTIONS.map(option => (
            <button
              key={option.id}
              role="option"
              aria-selected={option.id === value}
              onClick={() => { setOpen(false); onChange(option.id); }}
              style={{
                display:"flex", gap:8, width:"100%", padding:"6px 11px",
                border:"none", background:"transparent", color:"#000", textAlign:"left",
                fontFamily:"var(--mac-mono)", fontSize:12, cursor:"pointer",
              }}>
              <span style={{ width:8 }}>{option.id === value ? "•" : ""}</span>
              {option.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

const AgentRuntimeContext = React.createContext(null);

// Mounted by App for the full document lifetime. Authenticated relaunch
// recovery therefore runs without requiring navigation to the Agents screen.
function AgentRuntimeProvider({ ownerCredential, children }) {
  const [runtimeState, setRuntimeState] = useState({
    binding:null, localState:null, operation:null, installationId:null,
  });
  const coordinatorRef = useRef(null);
  if (!coordinatorRef.current) {
    const nativeRuntime = (command, payload, options) => (
      window.IndexApp.hermesRuntime(command, payload, options)
    );
    const operationStore = window.IndexApi.createNativeSagaJournal(
      nativeRuntime, window.localStorage,
    );
    coordinatorRef.current = window.IndexApi.createAgentRuntimeCoordinator({
      operationStore,
      nativeRuntime,
      waitForHealth:window.IndexApi.waitForHermesHealth,
      onState:setRuntimeState,
    });
  }
  const coordinator = coordinatorRef.current;

  useEffect(() => {
    let current = true;
    // Pin the exact credential supplied to this render, then ask the server for
    // that credential's authenticated app-user principal. ownerId is stable and
    // non-secret; it is never derived from or hashed from the credential.
    const api = ownerCredential && window.IndexApp
      ? window.IndexApp.getOwnerClient(ownerCredential)
      : null;
    if (!api) {
      coordinator.changeOwner(null).catch(() => {});
      return () => {};
    }
    api.auth.me().then(response => {
      const user = response && (response.user || response);
      if (!current || !user || !user.id) return null;
      return coordinator.changeOwner({
        ownerId:user.id,
        ownerCredential, api,
      });
    }).catch(() => {});
    return () => {
      current = false;
      coordinator.changeOwner(null).catch(() => {});
    };
  }, [coordinator, ownerCredential]);

  useEffect(() => {
    if (!ownerCredential || !window.IndexApp?.setLogoutSafetyHandler) return () => {};
    return window.IndexApp.setLogoutSafetyHandler(() => coordinator.prepareLogout());
  }, [coordinator, ownerCredential]);

  useEffect(() => {
    const timer = setInterval(() => { coordinator.refresh(); }, 15_000);
    return () => clearInterval(timer);
  }, [coordinator]);

  useEffect(() => () => coordinator.dispose(), [coordinator]);

  const runtimeView = window.IndexApi.mapAgentRuntimeState(runtimeState);
  const viewAction = action => () => window.IndexApi.runViewRuntimeAction(action);
  const value = {
    ...runtimeState,
    runtimeView,
    busy:runtimeState.operation && runtimeState.operation.status === "running",
    selectHermes:viewAction(() => coordinator.selectHermes(freshSetupAttemptId())),
    selectIndex:viewAction(() => coordinator.selectIndex()),
    disconnect:viewAction(() => coordinator.disconnect()),
    retry:viewAction(() => coordinator.retry()),
  };
  return <AgentRuntimeContext.Provider value={value}>{children}</AgentRuntimeContext.Provider>;
}

function useAgentRuntimeOwner() {
  const owner = React.useContext(AgentRuntimeContext);
  if (!owner) throw new Error("Agents must be mounted inside AgentRuntimeProvider");
  return owner;
}

// Agents is only the view and action surface; App owns runtime recovery.
function Agents({ onClose, onOpenMemory, onOpenHistory }) {
  const {
    runtimeView, busy, selectHermes, selectIndex, disconnect, retry,
  } = useAgentRuntimeOwner();

  const [, bump] = useState(0);
  const myNegotiator = myAgent();
  const shuffleCount = useRef(0);
  const shuffleFace = () => {
    shuffleCount.current += 1;
    setMyAgentFace({
      seed:`${currentMe().name}#${shuffleCount.current}-${Math.floor(performance.now())}`,
      photo:null,
    });
    bump(value => value + 1);
  };

  return (
    <div style={{
      position:"absolute", inset:0, display:"grid", placeItems:"center",
      gridTemplateColumns:"minmax(0, 1fr)", padding:"56px 40px", overflow:"auto",
    }}>
      <div style={{ width:860, maxWidth:"100%", height:"min(780px, calc(100vh - 96px))" }}>
        <MacWindow title="index · Personal Agent" onClose={onClose} style={{ height:"100%", minHeight:0 }}>
          <div style={{ padding:"18px 24px 14px", borderBottom:"2px solid #000" }}>
            <h2 style={{ margin:0, fontFamily:"var(--mac-mono)", fontSize:22, fontWeight:700 }}>
              Personal Agent
            </h2>
            <p style={{
              margin:"10px 0 0", maxWidth:620,
              fontFamily:"var(--mac-sans)", fontSize:13, lineHeight:1.5, color:"var(--ink-2)",
            }}>
              one agent speaks for you in the network. choose which runtime carries it.
            </p>
          </div>
          <div className="mac-scroll" style={{
            flex:"1 1 auto", minHeight:0, overflowY:"auto", padding:"18px 24px 22px",
          }}>
            <RuleLabel size={13}>negotiation runtime</RuleLabel>
            <div style={{ marginTop:9 }}>
              <NegotiatorSelect
                value={runtimeView.selectorValue}
                disabled={busy}
                onChange={value => value === "hermes" ? selectHermes() : selectIndex()}
              />
              <RuntimeStatus
                runtimeView={runtimeView}
                busy={busy}
                onRetry={retry}
                onDisconnect={disconnect}
              />
            </div>
            <SectionRule size={13}>identity, history, and policy</SectionRule>
            <NegotiatorProfile
              agent={myNegotiator}
              onShuffle={shuffleFace}
              onOpenMemory={onOpenMemory}
              onOpenHistory={onOpenHistory}
            />
          </div>
        </MacWindow>
      </div>
    </div>
  );
}
