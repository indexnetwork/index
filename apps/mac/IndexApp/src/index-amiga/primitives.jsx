// Amiga Workbench 1.3 primitives — same API as the Mac version, Amiga chrome.

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

// 3D bevel — "out" looks raised (gadget), "in" looks sunken (inset frame)
function bevel(kind = "out") {
  if (kind === "out") {
    return `inset 1px 1px 0 ${A.paper}, inset -1px -1px 0 ${A.edge}, 1px 1px 0 rgba(0,0,0,0.2)`;
  }
  return `inset 1px 1px 0 ${A.edge}, inset -1px -1px 0 ${A.paper}`;
}

/* ---------- LiveDot — blinking orange dot ---------- */
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

/* ---------- KV — key/value mono row ---------- */
function KV({ k, v, accent = false }) {
  return (
    <div style={{
      display:"flex", gap:12, fontFamily:"var(--mac-mono)", fontSize:11,
      color: A.fg, padding:"2px 0", lineHeight:1.3,
      alignItems:"baseline",
    }}>
      <span style={{ minWidth:92, color: A.mute, flex:"0 0 auto" }}>{k}</span>
      <span style={{
        color: accent ? A.shadow : A.fg, fontWeight: accent ? 700 : 400,
        flex:"1 1 auto", minWidth:0,
        overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap",
      }}>{v}</span>
    </div>
  );
}

/* ---------- Tag — Workbench gadget-style pill ---------- */
function Tag({ children, inverted = false, style }) {
  return (
    <span style={{
      fontFamily:"var(--mac-mono)", fontSize:10, letterSpacing:1,
      textTransform:"uppercase",
      color: inverted ? A.fg : A.fg,
      background: inverted ? A.accent : A.paper,
      border:`1px solid ${A.fg}`,
      padding:"1px 6px", lineHeight:1.2,
      whiteSpace:"nowrap",
      boxShadow: inverted
        ? `inset 1px 1px 0 ${A.highlight}, inset -1px -1px 0 ${A.shadow}`
        : `inset 1px 1px 0 ${A.paper}, inset -1px -1px 0 ${A.edge}`,
      fontWeight: inverted ? 700 : 400,
      ...style,
    }}>
      {children}
    </span>
  );
}

/* ---------- Avatar — Workbench raised square with initials ---------- */
function photoUrl(seed, px = 150) {
  return `https://i.pravatar.cc/${px}?u=${encodeURIComponent(seed || "x")}`;
}

function Avatar({ name, size = 28, ring = false, seed }) {
  const initials = (name || "")
    .split(/\s+/).slice(0,2).map(p => p[0]).join("").toUpperCase();
  const [broken, setBroken] = useState(false);
  return (
    <div style={{
      width:size, height:size, display:"grid", placeItems:"center",
      overflow:"hidden",
      background: ring ? A.accent : A.paper,
      border:`1px solid ${A.fg}`,
      boxShadow: ring
        ? `0 0 0 2px ${A.accent}, 0 0 0 3px ${A.fg}`
        : `1px 1px 0 rgba(0,0,0,0.2)`,
      color: A.fg,
      fontFamily:"var(--mac-mono)",
      fontSize: size * 0.38, letterSpacing:0.5,
      fontWeight: 700,
      flex:"0 0 auto",
    }}>
      {broken ? initials : (
        <img
          src={photoUrl(seed || name)}
          alt={name}
          onError={() => setBroken(true)}
          style={{
            width:"100%", height:"100%", objectFit:"cover", display:"block",
            // grayscale keeps the monochrome Workbench look
            filter:"grayscale(1) contrast(1.05)",
          }}
        />
      )}
    </div>
  );
}

/* ---------- RuleLabel — section header with rule ---------- */
function RuleLabel({ children }) {
  return (
    <div style={{
      display:"flex", alignItems:"center", gap:10,
      fontFamily:"var(--mac-mono)", fontSize:10, letterSpacing:2,
      textTransform:"uppercase",
      color: A.fg, margin:"12px 0 8px",
      fontWeight: 700,
    }}>
      <span>{children}</span>
      <div style={{ flex:1, height:2,
        background:`linear-gradient(${A.fg}, ${A.fg}) top/100% 1px no-repeat, linear-gradient(${A.paper}, ${A.paper}) bottom/100% 1px no-repeat`,
      }}/>
    </div>
  );
}

/* ---------- Btn — Workbench gadget. primary => orange. ---------- */
function Btn({ children, onClick, primary = false, small = false, style, disabled, type }) {
  const [active, setActive] = useState(false);
  const pad = small ? "3px 12px" : "5px 18px";
  const bg = primary ? A.accent : A.paper;
  return (
    <button
      type={type || "button"}
      onClick={onClick} disabled={disabled}
      onMouseDown={() => setActive(true)}
      onMouseUp={() => setActive(false)}
      onMouseLeave={() => setActive(false)}
      style={{
        padding: pad,
        fontFamily:"var(--mac-mono)",
        fontSize: small ? 11 : 12,
        textTransform:"lowercase",
        letterSpacing: 0.5,
        border:`1px solid ${A.fg}`,
        background: active ? A.fg : bg,
        color:   active ? bg : A.fg,
        borderRadius: 0,
        boxShadow: active
          ? `inset 1px 1px 0 ${A.edge}, inset -1px -1px 0 ${A.paper}`
          : primary
            ? `inset 1px 1px 0 ${A.highlight}, inset -1px -1px 0 ${A.shadow}, 1px 1px 0 rgba(0,0,0,0.2)`
            : `inset 1px 1px 0 ${A.paper}, inset -1px -1px 0 ${A.edge}, 1px 1px 0 rgba(0,0,0,0.2)`,
        transform: active ? "translate(1px,1px)" : "none",
        fontWeight: primary ? 700 : 500,
        opacity: disabled ? 0.45 : 1,
        cursor: disabled ? "not-allowed" : "pointer",
        ...style,
      }}
    >{children}</button>
  );
}

/* ---------- Chip — Workbench mini gadget ---------- */
function Chip({ children, onClick, active }) {
  const [down, setDown] = useState(false);
  const pressed = active || down;
  return (
    <button
      onClick={onClick}
      onMouseDown={() => setDown(true)}
      onMouseUp={() => setDown(false)}
      onMouseLeave={() => setDown(false)}
      style={{
        padding:"3px 12px",
        fontFamily:"var(--mac-mono)", fontSize:11,
        textTransform:"lowercase", letterSpacing: 0.5,
        whiteSpace:"nowrap",
        border:`1px solid ${A.fg}`,
        background: pressed ? A.accent : A.paper,
        color: A.fg,
        borderRadius: 0,
        boxShadow: pressed
          ? `inset 1px 1px 0 ${A.shadow}, inset -1px -1px 0 ${A.highlight}`
          : `inset 1px 1px 0 ${A.paper}, inset -1px -1px 0 ${A.edge}, 1px 1px 0 rgba(0,0,0,0.2)`,
        transform: pressed ? "translate(1px,1px)" : "none",
        fontWeight: pressed ? 700 : 400,
        cursor:"pointer",
      }}
    >{children}</button>
  );
}

/* ---------- ScoreBar — Workbench progress gauge ---------- */
function ScoreBar({ value, w = 56 }) {
  const pct = Math.max(0, Math.min(1, value));
  return (
    <div style={{
      width: w, height: 10, border:`1px solid ${A.fg}`,
      background: A.paper,
      boxShadow: `inset 1px 1px 0 ${A.edge}, inset -1px -1px 0 ${A.paper}`,
      position:"relative", overflow:"hidden", padding: 1,
    }}>
      <div style={{
        width: `${pct*100}%`, height:"100%",
        background: A.accent,
        boxShadow: `inset 0 1px 0 ${A.highlight}, inset 0 -1px 0 ${A.shadow}`,
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
      fontFamily:"var(--mac-mono)", fontSize:11, color: A.fg,
      whiteSpace:"nowrap", overflow:"hidden", position:"relative",
      height:18, maxWidth:380,
    }}>
      <div key={i} className="fade-up" style={{ position:"absolute", inset:0,
        textOverflow:"ellipsis", overflow:"hidden", whiteSpace:"nowrap" }}>
        <span style={{ marginRight:6, color: A.accent, fontWeight:700 }}>›</span>{cur.text}
      </div>
    </div>
  );
}

/* ---------- Stat — large number + uppercase label ---------- */
function Stat({ value, label, accent = false }) {
  return (
    <div style={{ display:"grid", gap:2 }}>
      <div style={{
        fontFamily:"var(--mac-sans)", fontSize:26, fontWeight: 700,
        letterSpacing:-0.5, lineHeight:1,
        ...(accent
          ? {
              background: A.accent, color: A.fg,
              padding:"2px 8px",
              display:"inline-block", width:"fit-content",
              border:`1px solid ${A.fg}`,
              boxShadow: `inset 1px 1px 0 ${A.highlight}, inset -1px -1px 0 ${A.shadow}`,
            }
          : { color: A.fg }),
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

/* ---------- PipelineFunnel — Amiga gadget strip ---------- */
// Minimal terminal-style readout — counts in monospace, hairline-divided.
// No progress bars (they read too "SaaS dashboard"); the number is the data.
function PipelineFunnel({ stages, mode = "broad", onClickStage, activeStage = "all" }) {
  const clickable = !!onClickStage;
  const allActive = activeStage === "all";
  return (
    <div style={{
      display:"flex",
      fontFamily:"var(--mac-mono)",
    }}>
      {stages.map((s, i) => {
        const last = i === stages.length - 1;
        const isActive = activeStage === s.label;
        const dim = !allActive && !isActive;
        const accent = s.accent && s.count > 0;
        const handleClick = clickable
          ? () => onClickStage(isActive ? "all" : s.label)
          : undefined;
        return (
          <button
            key={s.label}
            onClick={handleClick}
            disabled={!clickable}
            style={{
              flex:"1 1 0", minWidth:0,
              display:"flex", alignItems:"baseline", gap:7,
              padding:"7px 12px",
              background: isActive ? A.fg : "transparent",
              color: isActive ? A.paper : A.fg,
              opacity: dim ? 0.4 : 1,
              cursor: clickable ? "pointer" : "default",
              border:"none",
              borderRight: last ? "none" : `1px solid ${A.fg}`,
              borderRadius:0,
              textAlign:"left",
              fontFamily:"var(--mac-mono)",
            }}>
            <span style={{
              fontSize:17, fontWeight:700, lineHeight:1, letterSpacing:-0.5,
              color: accent ? A.accent : (isActive ? A.paper : A.fg),
            }}>{s.count}</span>
            <span style={{
              fontSize:10, letterSpacing:1, textTransform:"uppercase",
              opacity: isActive ? 0.85 : 0.6, whiteSpace:"nowrap",
              overflow:"hidden", textOverflow:"ellipsis",
            }}>{s.label}</span>
          </button>
        );
      })}
    </div>
  );
}

/* ---------- SourceBadge ---------- */
function SourceBadge({ source, sourceMeta }) {
  const cfg = {
    agent:      { glyph:"h", label:"from index" },
    individual: { glyph:"·", label: sourceMeta?.name ? `from ${sourceMeta.name}` : "from another agent" },
    collective: { glyph:"⁂", label: sourceMeta?.count ? `aggregated · ${sourceMeta.count} ${sourceMeta.of}` : "aggregated signal" },
    room:       { glyph:"≋", label: sourceMeta?.count ? `the room · ${sourceMeta.count} ${sourceMeta.of}` : "ambient · the room" },
  }[source] || { glyph:"·", label:"" };
  return (
    <div style={{
      display:"inline-flex", alignItems:"center", gap:6,
      padding:"2px 8px 2px 4px",
      border:`1px solid ${A.fg}`,
      background: A.paper,
      fontFamily:"var(--mac-mono)", fontSize:10, letterSpacing:0.6,
      color: A.fg, textTransform:"lowercase",
      boxShadow: `inset 1px 1px 0 ${A.paper}, inset -1px -1px 0 ${A.edge}`,
    }}>
      <span style={{
        display:"inline-grid", placeItems:"center",
        width:14, height:14,
        background: A.accent, color: A.fg,
        fontSize:10, fontWeight:700,
        border:`1px solid ${A.fg}`,
        boxShadow: `inset 1px 1px 0 ${A.highlight}, inset -1px -1px 0 ${A.shadow}`,
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
      padding:"3px 10px",
      border:`1px solid ${A.fg}`,
      background: cfg.inv ? A.accent : A.paper,
      color: A.fg,
      fontFamily:"var(--mac-mono)", fontSize:10, letterSpacing:0.6,
      boxShadow: cfg.inv
        ? `inset 1px 1px 0 ${A.highlight}, inset -1px -1px 0 ${A.shadow}`
        : `inset 1px 1px 0 ${A.paper}, inset -1px -1px 0 ${A.edge}`,
      fontWeight: cfg.inv ? 700 : 400,
    }}>
      <span style={{
        width:6, height:6, background: A.fg,
        animation: cfg.anim ? "mac-blink 1.4s steps(2) infinite" : "none",
      }}/>
      <span style={{ textTransform:"lowercase" }}>{cfg.t}</span>
      <span style={{ opacity:0.7 }}>· {cfg.sub}</span>
    </div>
  );
}

/* ---------- edit affordance ---------- */
// Corner badge for anything you can replace by clicking it: a profile photo, a
// network tile. Always visible rather than hover-only, since an affordance you
// can't see until you're already on it isn't doing its job. Hover just flips it
// to the accent. Sits in the corner rather than scrimming the whole image, so
// what you're editing stays legible.
function EditBadge({ hover, size = 16 }) {
  return (
    <span aria-hidden="true" style={{
      position:"absolute", right:-1, bottom:-1,
      width:size, height:size,
      border:"1px solid #000",
      background: hover ? A.accent : "#000",
      color:      hover ? "#000" : "#fff",
      display:"flex", alignItems:"center", justifyContent:"center",
      fontSize: Math.round(size * 0.6), lineHeight:1,
      transition:"background 120ms ease, color 120ms ease",
      pointerEvents:"none",
    }}>✎</span>
  );
}

// A data URL is roughly ⅓ larger than the file it came from; keep it sane for
// the WebView.
const PICTURE_MAX_BYTES = 4 * 1024 * 1024;

// The one way to replace a picture anywhere in the app — a profile photo, a
// network tile. The picture itself is the control, wearing the EditBadge in its
// corner; pass whatever renders it as children. Nothing is uploaded: the file
// is read locally into a data URL, so it still works with no network. The
// rules and their wording live here so every picker rejects the same things the
// same way, and the caller places `err` wherever its own layout wants it.
function PicturePicker({ size = 46, label = "change picture", onPick, onError, children }) {
  const fileRef = useRef(null);
  // hover or keyboard focus — the badge lights up for both, so tabbing to it
  // looks the same as pointing at it
  const [hot, setHot] = useState(false);

  const choose = (file) => {
    if (!file) return;
    const fail = (msg) => onError && onError(msg);
    if (!file.type.startsWith("image/")) { fail("that isn't an image."); return; }
    if (file.size > PICTURE_MAX_BYTES) { fail("that image is over 4mb. pick a smaller one."); return; }
    const reader = new FileReader();
    reader.onload  = () => { fail(""); onPick(reader.result); };
    reader.onerror = () => fail("couldn't read that file.");
    reader.readAsDataURL(file);
  };

  const open = () => fileRef.current && fileRef.current.click();

  return (
    <span
      onClick={open}
      onKeyDown={e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); open(); } }}
      onMouseEnter={() => setHot(true)}
      onMouseLeave={() => setHot(false)}
      onFocus={() => setHot(true)}
      onBlur={() => setHot(false)}
      role="button"
      tabIndex={0}
      aria-label={label}
      title={label}
      style={{
        position:"relative", flex:"0 0 auto", display:"block",
        width:size, height:size, cursor:"pointer", outline:"none",
      }}>
      {children}
      <EditBadge hover={hot}/>
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        onChange={e => { choose(e.target.files && e.target.files[0]); e.target.value = ""; }}
        style={{ display:"none" }}
      />
    </span>
  );
}

/* ---------- AmigaWindow — title bar with close gadget on left, depth on right ---------- */
function MacWindow({ title, children, style, bodyStyle, onClose, noShadow }) {
  return (
    // minWidth:0 + overflow:hidden keep a window inside its own frame. As a
    // grid item it would otherwise be floored at its content's min-content
    // width and paint over the window beside it — which is what the radar did
    // to the profile column once a third window opened.
    <div className="amiga-window" style={{
      display:"flex", flexDirection:"column",
      minWidth:0, minHeight:0, overflow:"hidden",
      ...style,
    }}>
      <div className="mac-titlebar">
        <span className="mac-close" onClick={onClose}/>
        <span className="mac-title"><span className="t">{title}</span></span>
      </div>
      <div style={{
        flex:1, minHeight:0, minWidth:0, display:"flex", flexDirection:"column",
        background: A.paper,
        ...bodyStyle,
      }}>{children}</div>
    </div>
  );
}

/* ---------- Workbench segmented control ---------- */
// size="lg" for full screens (settings, networks); default stays compact for
// the mainview toolbar, where a taller control would crowd the bar.
function MacSegmented({ value, onChange, options, size }) {
  const lg = size === "lg";
  return (
    <div style={{ display:"inline-flex", border:`1px solid ${A.fg}` }}>
      {options.map((opt, i) => {
        const sel = value === opt.value;
        return (
          <button key={opt.value}
            onClick={() => onChange(opt.value)}
            style={{
              padding: lg ? "7px 18px" : "3px 12px",
              background: sel ? A.accent : A.paper,
              color: A.fg,
              border:"none",
              borderLeft: i === 0 ? "none" : `1px solid ${A.fg}`,
              fontFamily:"var(--mac-mono)", fontSize: lg ? 13.5 : 11,
              textTransform:"lowercase",
              cursor:"pointer",
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

Object.assign(window, {
  LiveDot, StreamText, KV, Tag, Avatar, photoUrl, RuleLabel, Btn, Chip,
  ScoreBar, Ticker, Stat, useInterval,
  PipelineFunnel, SourceBadge, ModeBadge,
  MacWindow, MacSegmented, EditBadge, PicturePicker, PICTURE_MAX_BYTES,
  AMIGA_PALETTE: A,
});
