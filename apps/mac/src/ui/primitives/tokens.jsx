// Amiga Workbench 1.3 primitives, same API as the Mac version, Amiga chrome.

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

// 3D bevel, "out" looks raised (gadget), "in" looks sunken (inset frame)
function bevel(kind = "out") {
  if (kind === "out") {
    return `inset 1px 1px 0 ${A.paper}, inset -1px -1px 0 ${A.edge}, 1px 1px 0 rgba(0,0,0,0.2)`;
  }
  return `inset 1px 1px 0 ${A.edge}, inset -1px -1px 0 ${A.paper}`;
}

/* ---------- LiveDot: blinking orange dot ---------- */
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

/* ---------- StreamText: typewriter ---------- */
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

/* ---------- KV: key/value mono row ---------- */
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

/* ---------- Tag: Workbench gadget-style pill ---------- */
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

