/* ---------- RuleLabel: section header with rule ---------- */
function RuleLabel({ children, size = 10 }) {
  return (
    <div style={{
      display:"flex", alignItems:"center", gap:10,
      fontFamily:"var(--mac-mono)", fontSize:size,
      // the tracking is what makes small caps read as a heading; past ~11px it
      // starts to sprawl instead, so it eases off as the type grows
      letterSpacing: size >= 12 ? 1.4 : 2,
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

/* ---------- Btn: Workbench gadget. primary => orange. ---------- */
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

/* ---------- Chip: Workbench mini gadget ---------- */
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

/* ---------- ScoreBar: Workbench progress gauge ---------- */
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

/* ---------- Ticker: single rotating mono line ---------- */
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

/* ---------- Stat: large number + uppercase label ---------- */
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

/* ---------- useNarrow: true while the observed box is under `max` px ---------- */
// A pane loses most of its width the moment a third window opens next to it, so
// the layouts living inside one ask their own box how much room they have
// instead of trusting the window size.
function useNarrow(ref, max) {
  const [narrow, setNarrow] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver((entries) => {
      const w = entries[0] && entries[0].contentRect.width;
      if (w) setNarrow(w < max);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref, max]);
  return narrow;
}

/* ---------- PipelineFunnel: Amiga gadget strip ---------- */
// Label first, then its count in a badge. The tabs share the row equally so the
// strip fills the window width and always stays one row deep; a tab too narrow
// for its label truncates it ("negotiati…") rather than letting the text spill
// over its neighbours. The count never truncates, it is the part you read.
function PipelineFunnel({ stages, mode = "broad", onClickStage, activeStage = "all" }) {
  const clickable = !!onClickStage;
  const allActive = activeStage === "all";
  return (
    <div style={{
      display:"grid",
      gridTemplateColumns:`repeat(${stages.length}, minmax(0, 1fr))`,
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
            title={`${s.label} · ${s.count}`}
            style={{
              minWidth:0, overflow:"hidden",
              display:"flex", alignItems:"center", justifyContent:"center", gap:4,
              // tight sides: in a squeezed column every pixel here is a
              // character of the label that survives the truncation
              padding:"7px 5px",
              background: isActive ? A.fg : "transparent",
              color: isActive ? A.paper : A.fg,
              opacity: dim ? 0.45 : 1,
              cursor: clickable ? "pointer" : "default",
              border:"none",
              borderRight: last ? "none" : `1px solid ${A.fg}`,
              borderRadius:0,
              whiteSpace:"nowrap",
              fontFamily:"var(--mac-mono)",
            }}>
            <span style={{
              fontSize:10, letterSpacing:0.4, textTransform:"uppercase",
              minWidth:0, overflow:"hidden", textOverflow:"ellipsis",
            }}>{s.label}</span>
            <span style={{
              fontSize:10, fontWeight:700, lineHeight:1,
              padding:"3px 3px", minWidth:12, textAlign:"center", flex:"0 0 auto",
              border:`1px solid ${isActive ? A.paper : A.fg}`,
              background: accent ? A.accent : "transparent",
              color: accent ? A.fg : (isActive ? A.paper : A.fg),
            }}>{s.count}</span>
          </button>
        );
      })}
    </div>
  );
}

/* ---------- SourceBadge ---------- */
function SourceBadge({ source, sourceMeta }) {
  const owner = agentOwner(sourceMeta?.name);
  const cfg = {
    // your agent wears the same picture it wears everywhere else; a named
    // counterpart's wears its own
    agent:      { face: <MyAgentAvatar size={14}/>, label:"from your agent" },
    individual: { face: owner ? <AgentAvatar size={14} seed={owner}/> : <MyAgentAvatar size={14}/>,
                  label: `from ${agentLabel(sourceMeta?.name)}` },
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
      {cfg.face || (
      <span style={{
        display:"inline-grid", placeItems:"center",
        width:14, height:14,
        background: A.accent, color: A.fg,
        fontSize:10, fontWeight:700,
        border:`1px solid ${A.fg}`,
        boxShadow: `inset 1px 1px 0 ${A.highlight}, inset -1px -1px 0 ${A.shadow}`,
      }}>{cfg.glyph}</span>)}
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

// The one way to replace a picture anywhere in the app, a profile photo, a
// network tile. The picture itself is the control, wearing the EditBadge in its
// corner; pass whatever renders it as children. Nothing is uploaded: the file
// is read locally into a data URL, so it still works with no network. The
// rules and their wording live here so every picker rejects the same things the
// same way, and the caller places `err` wherever its own layout wants it.
function PicturePicker({ size = 46, label = "change picture", onPick, onError, children }) {
  const fileRef = useRef(null);
  // hover or keyboard focus, the badge lights up for both, so tabbing to it
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

/* ---------- Escape closes the topmost window ----------
   Windows push themselves onto a stack as they mount, so Escape always hits the
   one opened most recently: the profile panel rather than the signals window
   behind it. Doing it here rather than per screen means any window that takes
   an `onClose` gets the shortcut for free.

   Two things deliberately win over it. A menu or dialog that runs its own
   Escape marks the event handled in the capture phase, so its listener fires
   first and this one stands down. And Escape inside a text field blurs the
   field instead, so escaping out of the composer never throws away a draft. */
const macWindowStack = [];
let macEscapeBound = false;

function bindMacEscape() {
  if (macEscapeBound || typeof document === "undefined") return;
  macEscapeBound = true;
  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape" || e.defaultPrevented) return;
    const el = document.activeElement;
    if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable)) {
      el.blur();
      return;
    }
    for (let i = macWindowStack.length - 1; i >= 0; i--) {
      const close = macWindowStack[i].get();
      if (close) { e.preventDefault(); close(); return; }
    }
  });
}

/* ---------- AmigaWindow: title bar with close gadget on left, depth on right ---------- */
// `dismiss` swaps the close gadget for the bar gadget, see the CSS note.
// Use it for panels that sit beside the flow instead of holding it.
function MacWindow({ title, children, style, bodyStyle, onClose, noShadow, dismiss }) {
  // `onClose` is usually an inline arrow, so it is a new function every render.
  // The ref keeps the stack entry stable: registering on identity instead would
  // re-order the stack on every render and Escape would close the wrong window.
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    bindMacEscape();
    const entry = { get: () => closeRef.current };
    macWindowStack.push(entry);
    return () => {
      const i = macWindowStack.indexOf(entry);
      if (i !== -1) macWindowStack.splice(i, 1);
    };
  }, []);

  return (
    // minWidth:0 + overflow:hidden keep a window inside its own frame. As a
    // grid item it would otherwise be floored at its content's min-content
    // width and paint over the window beside it, which is what the radar did
    // to the profile column once a third window opened.
    <div className="amiga-window" style={{
      display:"flex", flexDirection:"column",
      minWidth:0, minHeight:0, overflow:"hidden",
      ...style,
    }}>
      <div className="mac-titlebar">
        <span
          className={dismiss ? "mac-close mac-dismiss" : "mac-close"}
          onClick={onClose}
          role="button"
          tabIndex={0}
          onKeyDown={e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onClose && onClose(); } }}
          title={dismiss ? "put away" : "close"}
          aria-label={dismiss ? "put away" : "close"}
        />
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

/* ---------- one-line, non-blocking notice ---------- */
// For the things the app can only report, not fix: a retired /c/ link, a deep
// link to a card this account cannot see. It sits at the foot of the desktop,
// times out on its own, and never takes the keyboard, so whatever the user was
// doing keeps working. Anything that needs a decision still gets a MacWindow.
function MacNotice({ text, onDismiss, timeoutMs = 7000 }) {
  useEffect(() => {
    if (!onDismiss) return;
    const t = setTimeout(onDismiss, timeoutMs);
    return () => clearTimeout(t);
  }, [text, timeoutMs]);
  if (!text) return null;
  return (
    <div
      onClick={onDismiss}
      role="status"
      title="dismiss"
      style={{
        position:"fixed", left:"50%", bottom:18, transform:"translateX(-50%)",
        maxWidth:"min(560px, calc(100% - 36px))",
        padding:"8px 14px", cursor:"default",
        background: A.paper, color: A.fg,
        border:`2px solid ${A.fg}`, boxShadow: bevel("out"),
        fontFamily:"var(--mac-mono)", fontSize:11.5, lineHeight:1.5,
        zIndex:1200,
      }}>{text}</div>
  );
}

Object.assign(window, {
  LiveDot, StreamText, KV, Tag, Avatar, BoringAvatar,
  AgentGlyph, AgentAvatar, agentOwner, agentLabel, SocialGlyph, RuleLabel, Btn, Chip,
  SOCIAL_PREFIX, EDITABLE_PLATFORMS, parseSocial, socialPlatformOf, socialHandleOf,
  socialHrefOf, socialApiLabelOf, buildSocialHref, normalizeSocial,
  splitProfileSocials, buildProfileSocials,
  AgentFace, agentFaceFor, ownAgentSeed, myAgent, MyAgentAvatar, currentMe,
  AGENT_FACES, AGENT_FACE_PALETTE,
  ScoreBar, Ticker, Stat, useInterval, useNarrow,
  PipelineFunnel, SourceBadge, ModeBadge,
  MacWindow, MacNotice, MacSegmented, EditBadge, PicturePicker, PICTURE_MAX_BYTES,
  AMIGA_PALETTE: A,
});
