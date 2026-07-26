// Amiga Workbench 1.3 primitives — mobile build.
// Same visual language as the desktop primitives, but press states fire on
// pointer events (so taps light up), and the desktop-window chrome is replaced
// by phone chrome: a status bar, a bottom tab bar, and full-screen sheets.

const { useState, useEffect, useRef, useMemo, useCallback } = React;

const A = {
  bg:   "#0055AA",
  fg:   "#000000",
  paper:"#FFFFFF",
  accent:"#FF8A00",
  highlight:"#FFD7A0",
  shadow:"#8A4500",
  edge: "#888888",
  mute: "#555555",
};

function bevel(kind = "out") {
  if (kind === "out") {
    return `inset 1px 1px 0 ${A.paper}, inset -1px -1px 0 ${A.edge}, 1px 1px 0 ${A.fg}`;
  }
  return `inset 1px 1px 0 ${A.edge}, inset -1px -1px 0 ${A.paper}`;
}

// usePress — shared press-state plumbing so taps and clicks both highlight.
function usePress() {
  const [down, setDown] = useState(false);
  const handlers = {
    onPointerDown: () => setDown(true),
    onPointerUp:   () => setDown(false),
    onPointerCancel:() => setDown(false),
    onPointerLeave:() => setDown(false),
  };
  return [down, handlers];
}

/* ---------- LiveDot ---------- */
function LiveDot({ size = 8 }) {
  return (
    <span style={{
      display:"inline-block", width:size, height:size,
      background: A.accent, border:`1px solid ${A.fg}`,
      animation:"mac-blink 1.2s steps(2) infinite",
      flex:"0 0 auto",
    }}/>
  );
}

/* ---------- StreamText — typewriter ---------- */
function StreamText({ text, speed = 14, delay = 0, onDone, className, style }) {
  const [out, setOut] = useState("");
  const [done, setDone] = useState(false);
  useEffect(() => {
    setOut(""); setDone(false);
    let i = 0; let timer;
    const start = setTimeout(() => {
      const tick = () => {
        i++; setOut(text.slice(0, i));
        if (i >= text.length){ setDone(true); onDone && onDone(); }
        else timer = setTimeout(tick, speed);
      };
      tick();
    }, delay);
    return () => { clearTimeout(start); clearTimeout(timer); };
  }, [text, speed, delay]);
  return (
    <span className={(className||"") + (done ? "" : " mac-caret")} style={style}>{out}</span>
  );
}

/* ---------- Tag ---------- */
function Tag({ children, inverted = false, style }) {
  return (
    <span style={{
      fontFamily:"var(--mac-mono)", fontSize:10, letterSpacing:1,
      textTransform:"uppercase",
      color: A.fg,
      background: inverted ? A.accent : A.paper,
      border:`1px solid ${A.fg}`,
      padding:"1px 6px", lineHeight:1.2, whiteSpace:"nowrap",
      boxShadow: inverted
        ? `inset 1px 1px 0 ${A.highlight}, inset -1px -1px 0 ${A.shadow}`
        : `inset 1px 1px 0 ${A.paper}, inset -1px -1px 0 ${A.edge}`,
      fontWeight: inverted ? 700 : 400,
      ...style,
    }}>{children}</span>
  );
}

/* ---------- Avatar ---------- */
function photoUrl(seed, px = 150) {
  return `https://i.pravatar.cc/${px}?u=${encodeURIComponent(seed || "x")}`;
}
function Avatar({ name, size = 28, ring = false, seed }) {
  const initials = (name || "")
    .split(/\s+/).slice(0,2).map(p => p[0]).join("").toUpperCase();
  const [broken, setBroken] = useState(false);
  return (
    <div style={{
      width:size, height:size, display:"grid", placeItems:"center", overflow:"hidden",
      background: ring ? A.accent : A.paper,
      border:`1px solid ${A.fg}`,
      boxShadow: ring ? `0 0 0 2px ${A.accent}, 0 0 0 3px ${A.fg}` : `1px 1px 0 ${A.fg}`,
      color: A.fg, fontFamily:"var(--mac-mono)",
      fontSize: size * 0.38, letterSpacing:0.5, fontWeight:700, flex:"0 0 auto",
    }}>
      {broken ? initials : (
        <img src={photoUrl(seed || name)} alt={name} onError={() => setBroken(true)}
          style={{ width:"100%", height:"100%", objectFit:"cover", display:"block",
                   filter:"grayscale(1) contrast(1.05)" }}/>
      )}
    </div>
  );
}

/* ---------- RuleLabel ---------- */
function RuleLabel({ children }) {
  return (
    <div style={{
      display:"flex", alignItems:"center", gap:10,
      fontFamily:"var(--mac-mono)", fontSize:10, letterSpacing:2,
      textTransform:"uppercase", color: A.fg, margin:"12px 0 8px", fontWeight:700,
    }}>
      <span>{children}</span>
      <div style={{ flex:1, height:2,
        background:`linear-gradient(${A.fg}, ${A.fg}) top/100% 1px no-repeat, linear-gradient(${A.paper}, ${A.paper}) bottom/100% 1px no-repeat` }}/>
    </div>
  );
}

/* ---------- Btn — Workbench gadget, touch-friendly ---------- */
function Btn({ children, onClick, primary = false, small = false, style, disabled, type, block }) {
  const [active, press] = usePress();
  const pad = small ? "6px 14px" : "10px 20px";
  const bg = primary ? A.accent : A.paper;
  return (
    <button
      type={type || "button"} onClick={onClick} disabled={disabled} {...press}
      style={{
        padding: pad, width: block ? "100%" : undefined,
        fontFamily:"var(--mac-mono)", fontSize: small ? 12 : 14,
        textTransform:"lowercase", letterSpacing:0.5,
        border:`1px solid ${A.fg}`,
        background: active ? A.fg : bg,
        color:   active ? bg : A.fg,
        borderRadius:0,
        boxShadow: active
          ? `inset 1px 1px 0 ${A.edge}, inset -1px -1px 0 ${A.paper}`
          : primary
            ? `inset 1px 1px 0 ${A.highlight}, inset -1px -1px 0 ${A.shadow}, 1px 1px 0 ${A.fg}`
            : `inset 1px 1px 0 ${A.paper}, inset -1px -1px 0 ${A.edge}, 1px 1px 0 ${A.fg}`,
        transform: active ? "translate(1px,1px)" : "none",
        fontWeight: primary ? 700 : 500,
        opacity: disabled ? 0.45 : 1,
        cursor: disabled ? "not-allowed" : "pointer",
        ...style,
      }}>{children}</button>
  );
}

/* ---------- Chip ---------- */
function Chip({ children, onClick, active }) {
  const [down, press] = usePress();
  const pressed = active || down;
  return (
    <button onClick={onClick} {...press}
      style={{
        padding:"6px 14px",
        fontFamily:"var(--mac-mono)", fontSize:12,
        textTransform:"lowercase", letterSpacing:0.5, whiteSpace:"nowrap",
        border:`1px solid ${A.fg}`,
        background: pressed ? A.accent : A.paper, color: A.fg, borderRadius:0,
        boxShadow: pressed
          ? `inset 1px 1px 0 ${A.shadow}, inset -1px -1px 0 ${A.highlight}`
          : `inset 1px 1px 0 ${A.paper}, inset -1px -1px 0 ${A.edge}, 1px 1px 0 ${A.fg}`,
        transform: pressed ? "translate(1px,1px)" : "none",
        fontWeight: pressed ? 700 : 400, cursor:"pointer",
      }}>{children}</button>
  );
}

/* ---------- Ticker ---------- */
function Ticker({ items, intervalMs = 2200 }) {
  const [i, setI] = useState(0);
  useEffect(() => {
    if (!items || !items.length) return;
    const t = setInterval(() => setI(x => (x + 1) % items.length), intervalMs);
    return () => clearInterval(t);
  }, [items, intervalMs]);
  if (!items || items.length === 0) return null;
  const cur = items[i % items.length];
  return (
    <div style={{
      fontFamily:"var(--mac-mono)", fontSize:11, color: A.fg,
      whiteSpace:"nowrap", overflow:"hidden", position:"relative", height:18, minWidth:0, flex:1,
    }}>
      <div key={i} className="fade-up" style={{ position:"absolute", inset:0,
        textOverflow:"ellipsis", overflow:"hidden", whiteSpace:"nowrap" }}>
        <span style={{ marginRight:6, color: A.accent, fontWeight:700 }}>›</span>{cur.text}
      </div>
    </div>
  );
}

/* ---------- Stat ---------- */
function Stat({ value, label, accent = false }) {
  return (
    <div style={{ display:"grid", gap:2 }}>
      <div style={{
        fontFamily:"var(--mac-sans)", fontSize:26, fontWeight:700,
        letterSpacing:-0.5, lineHeight:1,
        ...(accent ? {
          background: A.accent, color: A.fg, padding:"2px 8px",
          display:"inline-block", width:"fit-content",
          border:`1px solid ${A.fg}`,
          boxShadow: `inset 1px 1px 0 ${A.highlight}, inset -1px -1px 0 ${A.shadow}`,
        } : { color: A.fg }),
      }}>{value}</div>
      <div style={{
        fontFamily:"var(--mac-mono)", fontSize:10, letterSpacing:1.5,
        textTransform:"uppercase", color: A.fg,
      }}>{label}</div>
    </div>
  );
}

/* ---------- useInterval ---------- */
function useInterval(cb, delay) {
  const saved = useRef(cb);
  useEffect(() => { saved.current = cb; }, [cb]);
  useEffect(() => {
    if (delay == null) return;
    const id = setInterval(() => saved.current(), delay);
    return () => clearInterval(id);
  }, [delay]);
}

/* ---------- PipelineFunnel — Amiga gadget strip (fits a phone width) ---------- */
function PipelineFunnel({ stages, onClickStage, activeStage = "all" }) {
  const clickable = !!onClickStage;
  const allActive = activeStage === "all";
  return (
    <div style={{
      display:"flex",
      borderTop:`1px solid ${A.fg}`, borderBottom:`1px solid ${A.fg}`,
      fontFamily:"var(--mac-mono)",
    }}>
      {stages.map((s, i) => {
        const last = i === stages.length - 1;
        const isActive = activeStage === s.label;
        const dim = !allActive && !isActive;
        const accent = s.accent && s.count > 0;
        const handleClick = clickable ? () => onClickStage(isActive ? "all" : s.label) : undefined;
        return (
          <button key={s.label} onClick={handleClick} disabled={!clickable}
            style={{
              flex:"1 1 0", minWidth:0,
              display:"flex", flexDirection:"column", alignItems:"flex-start", gap:2,
              padding:"8px 8px",
              background: isActive ? A.fg : "transparent",
              color: isActive ? A.paper : A.fg,
              opacity: dim ? 0.4 : 1,
              cursor: clickable ? "pointer" : "default",
              border:"none", borderRight: last ? "none" : `1px solid ${A.fg}`,
              borderRadius:0, textAlign:"left", fontFamily:"var(--mac-mono)",
            }}>
            <span style={{
              fontSize:18, fontWeight:700, lineHeight:1, letterSpacing:-0.5,
              color: accent ? A.accent : (isActive ? A.paper : A.fg),
            }}>{s.count}</span>
            <span style={{
              fontSize:8.5, letterSpacing:0.5, textTransform:"uppercase",
              opacity: isActive ? 0.85 : 0.6, whiteSpace:"nowrap",
              overflow:"hidden", textOverflow:"ellipsis", maxWidth:"100%",
            }}>{s.label}</span>
          </button>
        );
      })}
    </div>
  );
}

/* ---------- MacSegmented ---------- */
function MacSegmented({ value, onChange, options }) {
  return (
    <div style={{ display:"inline-flex", border:`1px solid ${A.fg}` }}>
      {options.map((opt, i) => {
        const sel = value === opt.value;
        return (
          <button key={opt.value} onClick={() => onChange(opt.value)}
            style={{
              padding:"5px 14px",
              background: sel ? A.accent : A.paper, color: A.fg, border:"none",
              borderLeft: i === 0 ? "none" : `1px solid ${A.fg}`,
              fontFamily:"var(--mac-mono)", fontSize:12, textTransform:"lowercase", cursor:"pointer",
              boxShadow: sel
                ? `inset 1px 1px 0 ${A.shadow}, inset -1px -1px 0 ${A.highlight}`
                : `inset 1px 1px 0 ${A.paper}, inset -1px -1px 0 ${A.edge}`,
              fontWeight: sel ? 700 : 400,
            }}>{opt.label}</button>
        );
      })}
    </div>
  );
}

/* =================== PHONE CHROME =================== */

/* MobileTopBar — thin Workbench-white status strip under the system status bar. */
function MobileTopBar({ status }) {
  const [clock, setClock] = useState(macClock());
  useEffect(() => {
    const t = setInterval(() => setClock(macClock()), 30000);
    return () => clearInterval(t);
  }, []);
  return (
    <div className="mob-statusbar">
      <div className="bar">
        <span className="bold">index</span>
        <span className="right">
          {status ? <span>{status}</span> : null}
          <span>{clock}</span>
        </span>
      </div>
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

/* BottomNav — Workbench gadget tab bar. tabs: [{key, glyph, label, badge}] */
function BottomNav({ tabs, active, onChange }) {
  return (
    <div className="mob-bottomnav">
      {tabs.map(t => (
        <button key={t.key}
          className={"tab" + (active === t.key ? " active" : "")}
          onClick={() => onChange(t.key)}>
          {t.badge > 0 && <span className="badge">{t.badge > 99 ? "99" : t.badge}</span>}
          <span className="glyph">{t.glyph}</span>
          <span className="label">{t.label}</span>
        </button>
      ))}
    </div>
  );
}

/* Sheet — full-screen modal that slides up over the tabs, Workbench title bar. */
function Sheet({ title, onClose, children, footer }) {
  return (
    <div className="mob-sheet">
      <div className="mob-titlebar">
        <button className="close" onClick={onClose} aria-label="close"/>
        <span className="title"><span className="t">{title}</span></span>
      </div>
      <div style={{ flex:1, minHeight:0, display:"flex", flexDirection:"column", background:A.paper }}>
        {children}
      </div>
      {footer}
    </div>
  );
}

/* PanelHeader — a flush header for a tab's scroll view (no close gadget). */
function PanelHeader({ title, right }) {
  return (
    <div style={{
      flex:"0 0 auto", padding:"12px 16px", borderBottom:`2px solid ${A.fg}`,
      background:A.paper, display:"flex", alignItems:"center", gap:10,
    }}>
      <h2 style={{
        margin:0, fontFamily:"var(--amiga-title)", fontWeight:500,
        fontSize:17, color:A.fg, letterSpacing:-0.2, lineHeight:1.2,
        whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis",
      }}>{title}</h2>
      {right && <div style={{ marginLeft:"auto", flex:"0 0 auto" }}>{right}</div>}
    </div>
  );
}

Object.assign(window, {
  LiveDot, StreamText, Tag, Avatar, photoUrl, RuleLabel, Btn, Chip,
  Ticker, Stat, useInterval, usePress,
  PipelineFunnel, MacSegmented,
  MobileTopBar, BottomNav, Sheet, PanelHeader,
  AMIGA_PALETTE: A,
});
