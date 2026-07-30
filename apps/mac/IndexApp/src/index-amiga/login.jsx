// Login, the first surface, before the signals hub. An agent acts on your
// behalf, so signing in is really "give your agent an identity to run under".

function SignInButton({ children, primary, onClick, disabled }) {
  const [hover, setHover] = useState(false);
  const on = hover && !disabled;
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        width:"100%", padding:"11px 14px", textAlign:"center",
        cursor: disabled ? "default" : "pointer",
        border:"2px solid #000",
        fontFamily:"var(--mac-mono)", fontSize:13, fontWeight:700,
        opacity: disabled ? 0.5 : 1,
        boxShadow: on ? "none" : "3px 3px 0 rgba(0,0,0,0.22)",
        transform: on ? "translate(3px, 3px)" : "none",
        background: primary
          ? (on ? "#000" : "#FF8A00")
          : (on ? "#000" : "#fff"),
        color: primary
          ? (on ? "#FF8A00" : "#000")
          : (on ? "#fff" : "#000"),
      }}>{children}</button>
  );
}

// Between sign-in and the profile page, while the agent works out who you are.
// Mirrors the Calibrating screen's pinstripe + line stagger. Auto-advances
// once it's "done".
//
// The lines this replaced read like an intake form being processed at you
// ("reading your public profile", "pulling in what people already say about
// you"), which is both cold and, in the case of what other people say, not
// something index looks at. These are the agent thinking out loud instead.
function BuildingProfile({ onDone }) {
  const lines = [
    "getting a sense of you…",
    "working out what you're into…",
    "almost there.",
  ];
  useEffect(() => {
    const t = setTimeout(() => onDone && onDone(), 2400);
    return () => clearTimeout(t);
  }, []);
  return (
    <div style={{
      position:"absolute", inset:0,
      display:"grid", placeItems:"center",
      gridTemplateColumns:"minmax(0, 1fr)",
    }}>
      <MacWindow title="index · setting up" style={{ width: 420 }}>
        <div style={{ padding:"26px 28px 24px", textAlign:"center" }}>
          <div style={{
            display:"flex", justifyContent:"center",
            gap:10, alignItems:"center", marginBottom:18,
          }}>
            <LiveDot size={9}/>
            <span style={{
              fontFamily:"var(--mac-mono)",
              letterSpacing:3, fontSize:13, textTransform:"uppercase",
            }}>index</span>
          </div>

          {/* indeterminate progress, pinstripe, same as Calibrating */}
          <div style={{
            border:"1px solid #000", height: 10, overflow:"hidden",
            margin:"0 auto 18px", background: "#fff",
          }}>
            <div style={{
              height:"100%",
              backgroundImage:
                "repeating-linear-gradient(-45deg, #000 0, #000 6px, #fff 6px, #fff 12px)",
              animation:"mac-stripes 0.8s linear infinite",
              backgroundSize: "24px 24px",
            }}/>
          </div>

          {lines.map((l, i) => (
            <div key={i} className="fade-up" style={{
              animationDelay:`${i * 350}ms`,
              fontFamily:"var(--mac-sans)", fontSize: 15,
              color: i === lines.length - 1 ? "#000" : "var(--ink-2)",
              letterSpacing:0.2, padding:"4px 0",
              fontWeight: i === lines.length - 1 ? 700 : 400,
            }}>
              <span style={{ marginRight:8, fontFamily:"var(--mac-mono)" }}>›</span>{l}
            </div>
          ))}
        </div>
      </MacWindow>
    </div>
  );
}

function Login({ onSignIn }) {
  // Real auth is a browser handshake (the shell opens /cli-auth and hands back
  // a key). A single button starts it; the copy flips to "waiting" while the
  // browser round-trip runs.
  const [waiting, setWaiting] = useState(false);
  const go = () => {
    if (onSignIn && onSignIn(null)) setWaiting(true);
  };

  return (
    <div style={{
      position:"absolute", inset:0,
      display:"grid", placeItems:"center",
      gridTemplateColumns:"minmax(0, 1fr)",
      padding:"56px 40px", overflow:"auto",
    }}>
      <div style={{ width:420, maxWidth:"100%" }}>
        <MacWindow title="index" style={{ minHeight:0 }}>
          <div style={{ padding:"30px 30px 26px" }}>

            <h1 style={{
              fontFamily:"var(--amiga-mono)", fontWeight:500,
              fontSize:32, lineHeight:1.05, letterSpacing:-0.6,
              margin:0, color:"#000",
            }}>
              sign in to <span style={{ fontWeight:700 }}>index</span>.
            </h1>

            <p style={{
              marginTop:12, marginBottom:0,
              fontFamily:"var(--mac-sans)", fontSize:13, lineHeight:1.5, color:"#000",
            }}>
              index finds the right people for you, before you even think to
              look.
            </p>

            <div style={{ marginTop:22 }}>
              <SignInButton primary disabled={waiting} onClick={go}>
                {waiting ? "waiting for browser…" : "log in with browser"}
              </SignInButton>
            </div>

            <p style={{
              marginTop:20, marginBottom:0,
              fontFamily:"var(--mac-mono)", fontSize:10, lineHeight:1.5, color:"var(--ink-3)",
            }}>
              index only acts on what you tell it. you can stop any signal at any
              time.
            </p>
          </div>
        </MacWindow>
      </div>
    </div>
  );
}
