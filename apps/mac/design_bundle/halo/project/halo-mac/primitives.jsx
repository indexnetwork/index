// Mac System 6 B&W primitives — same API as the original, B&W chrome.

const { useState, useEffect, useRef, useMemo, useCallback } = React;

/* ---------- LiveDot — blinking black dot ---------- */
function LiveDot({ size = 8 }) {
  return (
    <span style={{
      display:"inline-block", width:size, height:size,
      background:"#000", border:"1px solid #000",
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

/* ---------- KV — key/value mono row ---------- */
function KV({ k, v, accent = false }) {
  return (
    <div style={{
      display:"flex", gap:12, fontFamily:"var(--mac-mono)", fontSize:11,
      color:"#000", padding:"2px 0", lineHeight:1.3,
      alignItems:"baseline",
    }}>
      <span style={{ minWidth:92, color:"#555", flex:"0 0 auto" }}>{k}</span>
      <span style={{
        color:"#000", fontWeight: accent ? 600 : 400,
        flex:"1 1 auto", minWidth:0,
        overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap",
      }}>{v}</span>
    </div>
  );
}

/* ---------- Tag — bracketed pill ---------- */
function Tag({ children, inverted = false, style }) {
  return (
    <span style={{
      fontFamily:"var(--mac-mono)", fontSize:10, letterSpacing:1,
      textTransform:"uppercase",
      color: inverted ? "#fff" : "#000",
      background: inverted ? "#000" : "#fff",
      border:"1px solid #000",
      padding:"1px 6px", lineHeight:1.2,
      whiteSpace:"nowrap",
      ...style,
    }}>
      {children}
    </span>
  );
}

/* ---------- Avatar — initials in classic Mac square ---------- */
function Avatar({ name, size = 28, ring = false }) {
  const initials = (name || "")
    .split(/\s+/).slice(0,2).map(p => p[0]).join("").toUpperCase();
  return (
    <div style={{
      width:size, height:size, display:"grid", placeItems:"center",
      background:"#fff",
      border:"1px solid #000",
      boxShadow: ring ? "0 0 0 2px #000" : "none",
      color:"#000",
      fontFamily:"var(--mac-mono)",
      fontSize: size * 0.38, letterSpacing:0.5,
      flex:"0 0 auto",
    }}>{initials}</div>
  );
}

/* ---------- RuleLabel — section header with rule ---------- */
function RuleLabel({ children }) {
  return (
    <div style={{
      display:"flex", alignItems:"center", gap:10,
      fontFamily:"var(--mac-mono)", fontSize:10, letterSpacing:2,
      textTransform:"uppercase",
      color:"#000", margin:"12px 0 8px",
    }}>
      <span>{children}</span>
      <div style={{ flex:1, height:1, background:"#000" }}/>
    </div>
  );
}

/* ---------- Btn — Mac pill button. primary => 2px focus ring ---------- */
function Btn({ children, onClick, primary = false, small = false, style, disabled, type }) {
  const [active, setActive] = useState(false);
  const pad = small ? "2px 12px" : "3px 18px";
  return (
    <button
      type={type || "button"}
      onClick={onClick} disabled={disabled}
      onMouseDown={() => setActive(true)}
      onMouseUp={() => setActive(false)}
      onMouseLeave={() => setActive(false)}
      className="mac-btn"
      style={{
        padding: pad,
        fontFamily:"var(--mac-sans)",
        fontSize: small ? 12 : 13,
        border:"1px solid #000",
        background: active ? "#000" : "#fff",
        color:   active ? "#fff" : "#000",
        borderRadius: 9,
        boxShadow: primary ? "0 0 0 2px #000" : "none",
        margin: primary ? 2 : 0,
        fontWeight: primary ? 700 : 400,
        opacity: disabled ? 0.45 : 1,
        cursor: disabled ? "not-allowed" : "pointer",
        ...style,
      }}
    >{children}</button>
  );
}

/* ---------- Chip — Mac pill ---------- */
function Chip({ children, onClick, active }) {
  const [down, setDown] = useState(false);
  return (
    <button
      onClick={onClick}
      onMouseDown={() => setDown(true)}
      onMouseUp={() => setDown(false)}
      onMouseLeave={() => setDown(false)}
      style={{
        padding:"2px 12px",
        fontFamily:"var(--mac-sans)", fontSize:12,
        border:"1px solid #000",
        background: (active || down) ? "#000" : "#fff",
        color:      (active || down) ? "#fff" : "#000",
        borderRadius: 9,
        cursor:"pointer",
      }}
    >{children}</button>
  );
}

/* ---------- ScoreBar — 1px box with pinstripe fill ---------- */
function ScoreBar({ value, w = 56 }) {
  const pct = Math.max(0, Math.min(1, value));
  return (
    <div style={{
      width: w, height: 7, border:"1px solid #000",
      background:"#fff",
      position:"relative", overflow:"hidden",
    }}>
      <div style={{
        width: `${pct*100}%`, height:"100%",
        backgroundImage:
          "repeating-linear-gradient(45deg, #000 0, #000 1px, #fff 1px, #fff 2px)",
      }}/>
    </div>
  );
}

/* ---------- Ticker — single rotating mono line ---------- */
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
      fontFamily:"var(--mac-mono)", fontSize:11, color:"#000",
      whiteSpace:"nowrap", overflow:"hidden", position:"relative",
      height:18, maxWidth:380,
    }}>
      <div key={i} className="fade-up" style={{ position:"absolute", inset:0,
        textOverflow:"ellipsis", overflow:"hidden", whiteSpace:"nowrap" }}>
        <span style={{ marginRight:6 }}>›</span>{cur.text}
      </div>
    </div>
  );
}

/* ---------- Stat — large number + uppercase label ---------- */
function Stat({ value, label, accent = false }) {
  return (
    <div style={{ display:"grid", gap:2 }}>
      <div style={{
        fontFamily:"var(--mac-sans)", fontSize:26, fontWeight: 400,
        color:"#000", letterSpacing:-0.5, lineHeight:1,
        background: accent ? "#000" : "transparent",
        color2: undefined,
        ...(accent ? { color:"#fff", padding:"2px 8px", display:"inline-block", width:"fit-content" } : {}),
      }}>{value}</div>
      <div style={{
        fontFamily:"var(--mac-mono)", fontSize:10, letterSpacing:1.5,
        textTransform:"uppercase", color:"#000",
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

/* ---------- PipelineFunnel — stage strip ---------- */
function PipelineFunnel({ stages, mode = "broad", onClickStage, activeStage = "all" }) {
  const max = Math.max(1, ...stages.map(s => s.count));
  const clickable = !!onClickStage;
  const allActive = activeStage === "all";
  return (
    <div style={{
      display:"grid",
      gridTemplateColumns:`repeat(${stages.length}, 1fr)`,
      border:"1px solid #000",
      background:"#fff",
    }}>
      {stages.map((s, i) => {
        const w = Math.max(0.05, s.count / max);
        const last = i === stages.length - 1;
        const isActive = activeStage === s.label;
        const dim = !allActive && !isActive;
        const handleClick = clickable
          ? () => onClickStage(isActive ? "all" : s.label)
          : undefined;
        return (
          <button
            key={s.label}
            onClick={handleClick}
            disabled={!clickable}
            style={{
              padding:"12px 14px 12px",
              borderRight: last ? "none" : "1px solid #000",
              position:"relative",
              background: isActive ? "#000" : (s.accent ? "#fff" : "#fff"),
              color:      isActive ? "#fff" : "#000",
              cursor: clickable ? "pointer" : "default",
              textAlign:"left",
              opacity: dim ? 0.45 : 1,
              fontFamily:"var(--mac-sans)",
              border:"none", borderRadius:0,
              minHeight: 84,
              display:"flex", flexDirection:"column", justifyContent:"space-between",
            }}>
            <div style={{
              fontSize:9, letterSpacing:2,
              textTransform:"uppercase",
              color: isActive ? "#fff" : "#000",
              marginBottom: 4,
              fontFamily:"var(--mac-mono)",
            }}>{s.label}</div>
            <div style={{
              fontFamily:"var(--mac-sans)",
              fontSize: 30, fontWeight: 400,
              lineHeight: 1, letterSpacing:-0.8,
              color: isActive ? "#fff" : "#000",
              marginBottom: 6,
            }}>{s.count}</div>
            <div style={{
              height: 4, border: `1px solid ${isActive ? "#fff" : "#000"}`,
              background:"#fff",
              position:"relative", overflow:"hidden",
            }}>
              <div style={{
                width: `${w * 100}%`, height:"100%",
                backgroundImage: isActive
                  ? "repeating-linear-gradient(45deg, #fff 0, #fff 1px, #000 1px, #000 2px)"
                  : "repeating-linear-gradient(45deg, #000 0, #000 1px, #fff 1px, #fff 2px)",
                transition:"width 600ms cubic-bezier(.2,.7,.2,1)",
              }}/>
            </div>
          </button>
        );
      })}
    </div>
  );
}

/* ---------- SourceBadge ---------- */
function SourceBadge({ source, sourceMeta }) {
  const cfg = {
    agent:      { glyph:"h", label:"from halo" },
    individual: { glyph:"·", label: sourceMeta?.name ? `from ${sourceMeta.name}` : "from another agent" },
    collective: { glyph:"Σ", label: sourceMeta?.count ? `aggregated · ${sourceMeta.count} ${sourceMeta.of}` : "aggregated signal" },
    room:       { glyph:"≋", label: sourceMeta?.count ? `the room · ${sourceMeta.count} ${sourceMeta.of}` : "ambient · the room" },
  }[source] || { glyph:"·", label:"" };
  return (
    <div style={{
      display:"inline-flex", alignItems:"center", gap:6,
      padding:"2px 8px 2px 4px",
      border:"1px solid #000",
      background:"#fff",
      fontFamily:"var(--mac-mono)", fontSize:10, letterSpacing:0.6,
      color:"#000", textTransform:"lowercase",
    }}>
      <span style={{
        display:"inline-grid", placeItems:"center",
        width:14, height:14,
        background:"#000", color:"#fff",
        fontSize:9, fontWeight:500,
      }}>{cfg.glyph}</span>
      <span>{cfg.label}</span>
    </div>
  );
}

/* ---------- ModeBadge ---------- */
function ModeBadge({ mode }) {
  const cfg = {
    broad:     { t:"broad scan",   sub:"inspecting widely",       inv:false, anim:true  },
    expanding: { t:"expanding",    sub:"new candidates incoming", inv:false, anim:true  },
    narrowing: { t:"narrowing",    sub:"filtering on your input", inv:true,  anim:true  },
    focused:   { t:"focused",      sub:"watching the few",        inv:true,  anim:false },
  }[mode] || {};
  return (
    <div style={{
      display:"inline-flex", alignItems:"center", gap:8,
      padding:"2px 10px",
      border:"1px solid #000",
      background: cfg.inv ? "#000" : "#fff",
      color:      cfg.inv ? "#fff" : "#000",
      fontFamily:"var(--mac-mono)", fontSize:10, letterSpacing:0.6,
    }}>
      <span style={{
        width:6, height:6, background: cfg.inv ? "#fff" : "#000",
        animation: cfg.anim ? "mac-blink 1.4s steps(2) infinite" : "none",
      }}/>
      <span style={{ textTransform:"lowercase" }}>{cfg.t}</span>
      <span style={{ opacity:0.7 }}>· {cfg.sub}</span>
    </div>
  );
}

/* ---------- MacWindow — frame: titlebar + close + content ---------- */
function MacWindow({ title, children, style, bodyStyle, onClose, noShadow }) {
  return (
    <div style={{
      background:"#fff",
      border:"1px solid #000",
      boxShadow: noShadow ? "none" : "1px 1px 0 #000",
      display:"flex", flexDirection:"column",
      ...style,
    }}>
      <div className="mac-titlebar">
        <span className="mac-close" onClick={onClose}/>
        <span className="mac-title">{title}</span>
        <span className="mac-zoom"/>
      </div>
      <div style={{
        flex:1, minHeight:0, minWidth:0, display:"flex", flexDirection:"column",
        ...bodyStyle,
      }}>{children}</div>
    </div>
  );
}

/* ---------- Mac dropdown / select-like (used for sim controls) ---------- */
function MacSegmented({ value, onChange, options }) {
  return (
    <div style={{ display:"inline-flex", border:"1px solid #000" }}>
      {options.map((opt, i) => (
        <button key={opt.value}
          onClick={() => onChange(opt.value)}
          style={{
            padding:"1px 10px",
            background: value === opt.value ? "#000" : "#fff",
            color:      value === opt.value ? "#fff" : "#000",
            border:"none",
            borderLeft: i === 0 ? "none" : "1px solid #000",
            fontFamily:"var(--mac-sans)", fontSize:12,
            cursor:"pointer",
          }}>{opt.label}</button>
      ))}
    </div>
  );
}

Object.assign(window, {
  LiveDot, StreamText, KV, Tag, Avatar, RuleLabel, Btn, Chip,
  ScoreBar, Ticker, Stat, useInterval,
  PipelineFunnel, SourceBadge, ModeBadge,
  MacWindow, MacSegmented,
});
