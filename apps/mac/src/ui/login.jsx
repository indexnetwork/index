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
// The caller can hand it its own title and lines: the boot pass and the
// public-research pass both wait behind this window, and saying the same things
// twice would read as the loader repeating rather than as two pieces of work.
function BuildingProfile({ onDone, title = "setting up", lines = [
  "getting a sense of you…",
  "working out what you're into…",
  "almost there.",
] }) {
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
      <MacWindow title={title} style={{ width: 420 }}>
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

// The one thing the agent cannot work out on its own, asked before it goes
// looking: a name is what the public-research lookup runs on, and the account
// name from a browser handshake is often a handle or plain wrong.
//
// Deliberately the sign-in card's shape rather than the profile form's. Asking
// one thing inside a form built to review a whole profile leaves either a
// collapsed window or a screen of fields nobody can touch yet; a card that only
// ever holds one question is small because that is its size.
function AskName({ initialName = "", onSubmit, onSignOut }) {
  const [name, setName] = useState(initialName);
  const ready = !!name.trim();

  return (
    <div style={{
      position:"absolute", inset:0,
      display:"grid", placeItems:"center",
      gridTemplateColumns:"minmax(0, 1fr)",
      padding:"56px 40px", overflow:"auto",
    }}>
      <div style={{ width:420, maxWidth:"100%" }}>
        <MacWindow title="getting started" onClose={onSignOut} style={{ minHeight:0 }}>
          <form
            onSubmit={(e) => { e.preventDefault(); if (ready) onSubmit(name.trim()); }}
            style={{ padding:"30px 30px 26px" }}>

            {/* Smaller than the sign-in card's 32px: that one is the app
                introducing itself, this one is a question. */}
            <h1 style={{
              fontFamily:"var(--amiga-mono)", fontWeight:500,
              fontSize:20, lineHeight:1.15, letterSpacing:-0.3,
              margin:0, color:"#000",
            }}>
              what's your <span style={{ fontWeight:700 }}>name</span>?
            </h1>

            <p style={{
              marginTop:12, marginBottom:0,
              fontFamily:"var(--mac-sans)", fontSize:13, lineHeight:1.5, color:"#000",
            }}>
              i'll use it to find what's already public about you, so you don't
              have to type it all out.
            </p>

            {/* Underlined rather than a sunken well: the well belongs to the
                profile form, where a field is one of many. Here it is the only
                thing on the card, so it reads as the line to write on. */}
            <input
              autoFocus
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="your name"
              aria-label="your name"
              style={{
                width:"100%", marginTop:22, padding:"7px 0",
                background:"transparent", border:"none",
                borderBottom:"1px solid #000", outline:"none",
                fontFamily:"var(--mac-sans)", fontSize:16, color:"#000",
              }}
            />

            <div style={{ marginTop:22 }}>
              <SignInButton primary disabled={!ready}>continue →</SignInButton>
            </div>

            <div style={{ marginTop:20, textAlign:"center" }}>
              <button
                type="button"
                onClick={onSignOut}
                style={{
                  fontFamily:"var(--mac-mono)", fontSize:10, padding:0,
                  border:"none", background:"transparent", color:"var(--ink-3)",
                  textDecoration:"underline", cursor:"pointer",
                }}>sign out</button>
            </div>
          </form>
        </MacWindow>
      </div>
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

  // A handshake that ends without a credential leaves this screen mounted, so
  // the button has to be released here: without it a failed sign-in is
  // indistinguishable from one still waiting on the browser.
  useEffect(() => {
    if (!window.IndexApp) return;
    return window.IndexApp.onAuthChanged((authenticated) => {
      if (!authenticated) setWaiting(false);
    });
  }, []);

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
