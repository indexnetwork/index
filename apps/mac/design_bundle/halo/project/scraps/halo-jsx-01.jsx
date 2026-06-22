// Shared primitives for halo
const { useState, useEffect, useRef, useMemo, useCallback } = React;

// A small dot that pulses orange — "live" indicator
function LiveDot({ size = 8, color = "var(--orange)" }) {
  return (
    <span
      style={{
        display: "inline-block",
        width: size,
        height: size,
        borderRadius: 999,
        background: color,
        boxShadow: `0 0 ${size * 2}px ${color}80, 0 0 1px ${color}`,
        animation: "pulse-dot 2.2s ease-out infinite",
        flex: "0 0 auto",
      }}
    />
  );
}

// Typing/streaming text — reveals char by char
function StreamText({ text, speed = 14, delay = 0, onDone, className, style }) {
  const [out, setOut] = useState("");
  const [done, setDone] = useState(false);
  useEffect(() => {
    setOut("");
    setDone(false);
    let i = 0;
    let timer;
    const start = setTimeout(() => {
      const tick = () => {
        i++;
        setOut(text.slice(0, i));
        if (i >= text.length) {
          setDone(true);
          onDone && onDone();
        } else {
          timer = setTimeout(tick, speed);
        }
      };
      tick();
    }, delay);
    return () => { clearTimeout(start); clearTimeout(timer); };
  }, [text, speed, delay]);
  return (
    <span className={(className || "") + (done ? "" : " caret")} style={style}>
      {out}
    </span>
  );
}

// Monospace key/value line
function KV({ k, v, accent = false }) {
  return (
    <div style={{
      display: "flex", gap: 12, fontFamily: "var(--mono)", fontSize: 11.5,
      color: "var(--dim)", padding: "2px 0",
    }}>
      <span style={{ minWidth: 92, color: "var(--dim-2)" }}>{k}</span>
      <span style={{ color: accent ? "var(--orange)" : "var(--text-2)" }}>{v}</span>
    </div>
  );
}

// Bracketed mono label (like [ ready ])
function Tag({ children, color = "var(--dim)", glow = false, style }) {
  return (
    <span style={{
      fontFamily: "var(--mono)", fontSize: 10.5, letterSpacing: 0.4,
      textTransform: "lowercase",
      color, padding: "2px 6px",
      border: `1px solid ${color === "var(--orange)" ? "rgba(255,122,26,0.35)" : "var(--line)"}`,
      borderRadius: 2,
      background: color === "var(--orange)" ? "rgba(255,122,26,0.07)" : "transparent",
      boxShadow: glow ? "0 0 12px rgba(255,122,26,0.25)" : "none",
      whiteSpace: "nowrap",
      ...style,
    }}>
      {children}
    </span>
  );
}

// Small initials avatar (no decoration, just an inset square)
function Avatar({ name, size = 28, ring = false }) {
  const initials = name
    .split(/\s+/).slice(0,2).map(p => p[0]).join("").toUpperCase();
  // Hash to a hue but desaturate heavily so it stays in palette
  let h = 0; for (const c of name) h = (h * 31 + c.charCodeAt(0)) % 360;
  return (
    <div style={{
      width: size, height: size,
      display: "grid", placeItems: "center",
      borderRadius: 3,
      background: `linear-gradient(135deg, hsl(${h} 8% 18%), hsl(${(h+40)%360} 6% 12%))`,
      border: ring ? "1px solid rgba(255,122,26,0.5)" : "1px solid var(--line)",
      boxShadow: ring ? "0 0 12px rgba(255,122,26,0.35)" : "none",
      color: "var(--text-2)",
      fontFamily: "var(--mono)",
      fontSize: size * 0.36,
      letterSpacing: 0.5,
      flex: "0 0 auto",
    }}>{initials}</div>
  );
}

// A horizontal divider with a label
function RuleLabel({ children, color = "var(--dim-2)" }) {
  return (
    <div style={{
      display: "flex", alignItems: "center", gap: 10,
      fontFamily: "var(--mono)", fontSize: 10.5, letterSpacing: 1.2,
      textTransform: "uppercase",
      color, margin: "12px 0",
    }}>
      <span>{children}</span>
      <div style={{ flex: 1, height: 1, background: "var(--line)" }} />
    </div>
  );
}

// Subtle button
function Btn({ children, onClick, primary = false, small = false, style, disabled }) {
  const [hover, setHover] = useState(false);
  const pad = small ? "5px 10px" : "9px 14px";
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        padding: pad,
        fontFamily: "var(--mono)",
        fontSize: small ? 11 : 12,
        letterSpacing: 0.3,
        textTransform: "lowercase",
        borderRadius: 2,
        border: primary
          ? "1px solid rgba(255,122,26,0.6)"
          : "1px solid var(--line-2)",
        background: primary
          ? (hover ? "rgba(255,122,26,0.18)" : "rgba(255,122,26,0.10)")
          : (hover ? "rgba(255,255,255,0.05)" : "transparent"),
        color: primary ? "var(--orange-2)" : "var(--text-2)",
        boxShadow: primary && hover ? "0 0 22px rgba(255,122,26,0.25)" : "none",
        opacity: disabled ? 0.4 : 1,
        transition: "all .18s ease",
        cursor: disabled ? "not-allowed" : "pointer",
        ...style,
      }}
    >{children}</button>
  );
}

// Chip (selectable)
function Chip({ children, onClick, active }) {
  const [hover, setHover] = useState(false);
  return (
    <button
      onClick={onClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        padding: "4px 10px",
        fontFamily: "var(--mono)",
        fontSize: 11,
        textTransform: "lowercase",
        borderRadius: 999,
        border: `1px solid ${active ? "rgba(255,122,26,0.5)" : "var(--line)"}`,
        background: active ? "rgba(255,122,26,0.12)" : (hover ? "rgba(255,255,255,0.04)" : "transparent"),
        color: active ? "var(--orange-2)" : "var(--text-2)",
        transition: "all .15s ease",
      }}
    >{children}</button>
  );
}

// Score bar (0..1)
function ScoreBar({ value, w = 56 }) {
  const pct = Math.max(0, Math.min(1, value));
  return (
    <div style={{
      width: w, height: 3, background: "rgba(255,255,255,0.06)", borderRadius: 2,
      position: "relative", overflow: "hidden",
    }}>
      <div style={{
        width: `${pct*100}%`, height: "100%",
        background: "linear-gradient(90deg, #7a3a10, var(--orange))",
        boxShadow: "0 0 10px rgba(255,122,26,0.5)",
      }} />
    </div>
  );
}

// A horizontal ticker (one line, animated entry)
function Ticker({ items, intervalMs = 2200 }) {
  const [i, setI] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setI(x => (x + 1) % items.length), intervalMs);
    return () => clearInterval(t);
  }, [items, intervalMs]);
  return (
    <div style={{
      fontFamily: "var(--mono)", fontSize: 11, color: "var(--dim)",
      whiteSpace: "nowrap", overflow: "hidden", position: "relative",
      height: 18,
    }}>
      <div key={i} className="fade-up" style={{ position: "absolute", inset: 0 }}>
        <span style={{ color: "var(--orange-dim)" }}>›</span>{" "}{items[i].text}
      </div>
    </div>
  );
}

// Stat block (number + label)
function Stat({ value, label, accent = false }) {
  return (
    <div style={{ display: "grid", gap: 2 }}>
      <div style={{
        fontFamily: "var(--mono)", fontSize: 22, fontWeight: 300,
        color: accent ? "var(--orange-2)" : "var(--text)",
        textShadow: accent ? "0 0 16px rgba(255,122,26,0.3)" : "none",
        letterSpacing: -0.5,
      }}>{value}</div>
      <div style={{
        fontFamily: "var(--mono)", fontSize: 10, letterSpacing: 0.8,
        textTransform: "uppercase", color: "var(--dim-2)",
      }}>{label}</div>
    </div>
  );
}

// Useful: an interval hook
function useInterval(cb, delay) {
  const savedCb = useRef(cb);
  useEffect(() => { savedCb.current = cb; }, [cb]);
  useEffect(() => {
    if (delay == null) return;
    const id = setInterval(() => savedCb.current(), delay);
    return () => clearInterval(id);
  }, [delay]);
}

// === Pipeline funnel — strategy-game-style stage bar
// stages: [{ label, count, accent? }]
// optional: onClickStage(label), activeStage (label string or "all")
function PipelineFunnel({ stages, mode = "broad", onClickStage, activeStage = "all" }) {
  const max = Math.max(1, ...stages.map(s => s.count));
  const clickable = !!onClickStage;
  const allActive = activeStage === "all";
  return (
    <div style={{
      display: "grid",
      gridTemplateColumns: `repeat(${stages.length}, 1fr)`,
      gap: 0,
      fontFamily: "var(--mono)",
      fontSize: 11,
      letterSpacing: 0.3,
      border: "1px solid var(--line)",
      background: "var(--bg)",
    }}>
      {stages.map((s, i) => {
        const w = Math.max(0.04, s.count / max);
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
              padding: "20px 18px 18px",
              borderRight: last ? "none" : "1px solid var(--line)",
              position: "relative",
              background: isActive
                ? "rgba(255,122,26,0.10)"
                : (s.accent ? "rgba(255,122,26,0.04)" : "transparent"),
              boxShadow: isActive ? "inset 0 -3px 0 var(--orange)" : "none",
              cursor: clickable ? "pointer" : "default",
              textAlign: "left",
              opacity: dim ? 0.42 : 1,
              transition: "background .18s, opacity .18s",
              fontFamily: "var(--mono)",
              border: "none",
              borderRadius: 0,
              color: "inherit",
              minHeight: 96,
              display: "flex", flexDirection: "column", justifyContent: "space-between",
            }}>
            <div style={{
              fontSize: 10.5, letterSpacing: 1.4,
              textTransform: "uppercase",
              color: isActive ? "var(--orange-2)" : "var(--dim-2)",
              marginBottom: 8,
            }}>{s.label}</div>
            <div style={{
              display: "flex", alignItems: "baseline", gap: 6,
              marginBottom: 12,
            }}>
              <span style={{
                color: isActive ? "var(--orange-2)" : (s.accent ? "var(--orange-2)" : "var(--text)"),
                fontVariantNumeric: "tabular-nums",
                fontSize: 36, fontWeight: 300,
                lineHeight: 1, letterSpacing: -1,
                textShadow: (s.accent || isActive) ? "0 0 18px rgba(255,122,26,0.25)" : "none",
              }}>{s.count}</span>
            </div>
            <div style={{
              height: 4,
              background: "rgba(255,255,255,0.04)",
              position: "relative", overflow: "hidden",
            }}>
              <div style={{
                width: `${w * 100}%`, height: "100%",
                background: (s.accent || isActive)
                  ? "linear-gradient(90deg, var(--orange-dim), var(--orange))"
                  : "linear-gradient(90deg, rgba(255,255,255,0.12), rgba(255,255,255,0.22))",
                boxShadow: (s.accent || isActive) ? "0 0 10px rgba(255,122,26,0.45)" : "none",
                transition: "width 600ms cubic-bezier(.2,.7,.2,1)",
              }} />
            </div>
            {!last && (
              <span style={{
                position: "absolute", right: -6, top: "50%", transform: "translateY(-50%)",
                color: "var(--dim-2)", fontSize: 13, zIndex: 1,
                background: "var(--bg)", padding: "0 2px",
              }}>›</span>
            )}
          </button>
        );
      })}
    </div>
  );
}

// === Scan strip — flickering ghost candidates being inspected
function ScanStrip({ ghosts, mode }) {
  const [i, setI] = useState(0);
  useEffect(() => {
    if (mode === "focused") return;
    const interval = mode === "broad" ? 900 : 1700;
    const t = setInterval(() => {
      setI(x => (x + 1) % ghosts.length);
    }, interval);
    return () => clearInterval(t);
  }, [mode, ghosts.length]);

  if (mode === "focused") {
    return (
      <div style={{
        fontFamily: "var(--mono)", fontSize: 10.5, color: "var(--dim-2)",
        letterSpacing: 0.4, padding: "6px 0",
      }}>
        — pipeline focused · not scanning ambient
      </div>
    );
  }

  const g = ghosts[i % ghosts.length];
  return (
    <div style={{
      fontFamily: "var(--mono)", fontSize: 10.5, color: "var(--dim)",
      display: "grid", gridTemplateColumns: "auto 110px 1fr",
      gap: 12, padding: "6px 0", alignItems: "baseline",
      overflow: "hidden",
    }}>
      <span style={{ color: "var(--orange-dim)" }}>scan</span>
      <span key={"name" + i} className="fade-in" style={{ color: "var(--text-2)" }}>
        {g.name}
      </span>
      <span key={"verdict" + i} className="fade-in" style={{ color: "var(--dim-2)" }}>
        → {g.verdict}
      </span>
    </div>
  );
}

// === Source badge for clarifier — varies by where the question came from
function SourceBadge({ source, sourceMeta }) {
  const cfg = {
    agent: {
      glyph: "h",
      color: "var(--orange)",
      bg: "rgba(255,122,26,0.06)",
      border: "rgba(255,122,26,0.4)",
      label: "from halo",
    },
    individual: {
      glyph: "·",
      color: "var(--text-2)",
      bg: "transparent",
      border: "var(--line-2)",
      label: sourceMeta?.name ? `from ${sourceMeta.name}` : "from another agent",
    },
    collective: {
      glyph: "Σ",
      color: "var(--orange-2)",
      bg: "rgba(255,122,26,0.05)",
      border: "rgba(255,122,26,0.28)",
      label: sourceMeta?.count
        ? `aggregated · ${sourceMeta.count} ${sourceMeta.of}`
        : "aggregated signal",
    },
    room: {
      glyph: "≋",
      color: "var(--text)",
      bg: "rgba(255,255,255,0.02)",
      border: "var(--line-2)",
      label: sourceMeta?.count
        ? `the room · ${sourceMeta.count} ${sourceMeta.of}`
        : "ambient · the room",
    },
  }[source] || {};
  return (
    <div style={{
      display: "inline-flex", alignItems: "center", gap: 8,
      padding: "3px 8px 3px 6px",
      border: `1px solid ${cfg.border}`,
      background: cfg.bg,
      fontFamily: "var(--mono)", fontSize: 10, letterSpacing: 0.6,
      color: cfg.color,
      textTransform: "lowercase",
    }}>
      <span style={{
        display: "inline-grid", placeItems: "center",
        width: 14, height: 14,
        border: `1px solid ${cfg.border}`,
        fontSize: 9, fontWeight: 500,
        color: cfg.color,
      }}>{cfg.glyph}</span>
      <span style={{ color: cfg.color === "var(--orange-2)" ? "var(--orange-2)" : "var(--text-2)" }}>{cfg.label}</span>
    </div>
  );
}

// === Mode badge for pipeline state
function ModeBadge({ mode }) {
  const cfg = {
    broad:     { c: "var(--text-2)",  t: "broad scan",   sub: "inspecting widely" },
    expanding: { c: "var(--orange-2)",t: "expanding",    sub: "new candidates incoming" },
    narrowing: { c: "var(--orange)",  t: "narrowing",    sub: "filtering on your input" },
    focused:   { c: "var(--orange)",  t: "focused",      sub: "watching the few that matter" },
  }[mode] || {};
  return (
    <div style={{
      display: "inline-flex", alignItems: "center", gap: 10,
      padding: "4px 10px",
      border: `1px solid ${cfg.c === "var(--text-2)" ? "var(--line-2)" : "rgba(255,122,26,0.4)"}`,
      background: cfg.c === "var(--text-2)" ? "transparent" : "rgba(255,122,26,0.07)",
      boxShadow: cfg.c === "var(--orange)" ? "0 0 14px rgba(255,122,26,0.18)" : "none",
      fontFamily: "var(--mono)", fontSize: 10.5, letterSpacing: 0.4,
    }}>
      <span style={{
        width: 6, height: 6, borderRadius: 999, background: cfg.c,
        animation: mode !== "focused" ? "pulse-dot 1.8s ease-out infinite" : "none",
        boxShadow: `0 0 8px ${cfg.c}`,
      }} />
      <span style={{ color: cfg.c, textTransform: "lowercase" }}>{cfg.t}</span>
      <span style={{ color: "var(--dim-2)" }}>· {cfg.sub}</span>
    </div>
  );
}

Object.assign(window, {
  LiveDot, StreamText, KV, Tag, Avatar, RuleLabel, Btn, Chip,
  ScoreBar, Ticker, Stat, useInterval,
  PipelineFunnel, ScanStrip, SourceBadge, ModeBadge,
});
