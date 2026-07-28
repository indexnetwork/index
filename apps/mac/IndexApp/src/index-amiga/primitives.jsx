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

/* ---------- Avatar: Workbench raised square with initials ---------- */
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

/* ---------- AgentAvatar: the mark every agent wears ----------
   Agents never get a face. Where a person shows a photo, an agent shows this
   stroked robot mark in the same square frame, so you can tell at a glance
   whether the thing talking to you is a human or something running on their
   behalf. `collective` is the same frame inverted, for "several agents at
   once", one asterism instead of one head. */
function AgentGlyph({ size = 14, color = A.fg }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
      stroke={color} strokeWidth={2} strokeLinecap="square" strokeLinejoin="miter"
      style={{ display:"block" }}>
      <line x1="12" y1="3" x2="12" y2="6"/>
      <circle cx="12" cy="2.5" r="1" fill={color} stroke="none"/>
      <rect x="4" y="6" width="16" height="12" rx="1.5"/>
      <line x1="2" y1="11" x2="4" y2="11"/>
      <line x1="20" y1="11" x2="22" y2="11"/>
      <rect x="8.5" y="10" width="2" height="2.5" fill={color} stroke="none"/>
      <rect x="13.5" y="10" width="2" height="2.5" fill={color} stroke="none"/>
      <line x1="9" y1="15" x2="15" y2="15"/>
    </svg>
  );
}

/* An agent is always somebody's. There is no such thing as "an agent" loose in
   the network, so nothing in the app should ever say that, a nameless one is
   yours. Sources arrive inconsistently: some carry the bare person ("ilya"),
   some already carry the possessive ("ilya's agent"), so strip any trailing
   agent suffix before adding our own and we never say "ilya's agent's agent". */
function agentOwner(name) {
  return String(name || "").trim().replace(/[’']s\s+agent$|\s+agent$/i, "").trim();
}

function agentLabel(name) {
  const owner = agentOwner(name);
  if (!owner) return "your agent";
  // the API falls back to "unknown" when a counterparty has no name on it.
  // the person is unknown, the agent still belongs to them
  if (/^unknown$/i.test(owner)) return "someone's agent";
  return `${owner}'s agent`;
}

/* ---------- Agent faces (from the "agent avatar kit" design) ----------
   Ten flat marks, each drawn in a 160x160 space out of nothing but rectangles,
   circles and a 2px black keyline. Every face takes its colours as slots rather
   than baking them in, so a face and a palette draw combine into a distinct
   avatar: 10 faces x an ordered pick of 4 from 6 colours = 3,600 possibilities,
   which is enough that two people in the same room will not collide.

   The draw is a hash of the owner's name, not a random number, so an agent
   keeps its face forever and looks the same on every device, "random" in
   appearance, deterministic in fact. */
const AGENT_FACE_PALETTE = ["#0B5FA5", "#2E8B7A", "#E8C84A", "#7B62B8", "#C9518B", "#F26B0F"];
const FACE_INK = "#111";
const FACE_PAPER = "#FAF8F3";
const FACE_UNIT = 160;   // the coordinate space every face is drawn in

/** xorshift seeded by an FNV-1a hash of the string, same seed, same stream. */
function faceRandom(seed) {
  let h = 2166136261 >>> 0;
  const s = String(seed || "index");
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return () => {
    h ^= h << 13; h >>>= 0;
    h ^= h >>> 17;
    h ^= h << 5;  h >>>= 0;
    return h / 4294967296;
  };
}

const px = (n) => `${n}px`;
/** Absolute layer in the 160-space. */
function L(key, left, top, w, h, extra) {
  return { key, left, top, w, h, ...extra };
}

// Each face: `bg` paints the tile, `layers` returns the pieces stacked on it.
// `c` is the drawn palette, c[0..3], already distinct.
const AGENT_FACES = [
  { name: "sentinel",
    bg: (c) => c[0],
    layers: (c) => [
      L("stem", 76, 10, 8, 22, { bg: FACE_INK }),
      L("cap", 66, 0, 28, 14, { bg: c[1], line: true }),
      L("eyeL", 24, 52, 36, 36, { bg: FACE_PAPER, line: true }),
      L("eyeR", 96, 52, 36, 36, { bg: FACE_PAPER, line: true }),
      L("pupL", 36, 64, 14, 14, { bg: FACE_INK }),
      L("pupR", 108, 64, 14, 14, { bg: FACE_INK }),
      L("mouth", 40, 112, 76, 14, { bg: FACE_INK }),
    ] },
  { name: "beacon",
    bg: (c) => c[0],
    layers: (c) => [
      L("iris", 28, 28, 100, 100, { bg: c[1], line: true, round: true }),
      L("pupil", 60, 60, 36, 36, { bg: FACE_INK, round: true }),
      L("glint", 70, 70, 12, 12, { bg: FACE_PAPER, round: true }),
      L("nubL", 0, 74, 26, 12, { bg: FACE_INK }),
      L("nubR", 134, 74, 26, 12, { bg: FACE_INK }),
    ] },
  { name: "visor",
    bg: () => FACE_PAPER,
    layers: (c) => [
      L("band", 18, 20, 120, 14, { bg: c[1], line: true }),
      L("visor", 18, 44, 120, 44, { bg: c[0], line: true,
        inner: [L("vL", 0, 0, 20, 20, { bg: FACE_INK }), L("vR", 0, 0, 20, 20, { bg: FACE_INK })],
        innerRow: true }),
      L("legL", 40, 106, 22, 34, { bg: FACE_INK }),
      L("legR", 94, 106, 22, 34, { bg: FACE_INK }),
    ] },
  { name: "cyclops",
    bg: (c) => c[0],
    layers: () => [
      L("eye", 44, 26, 72, 72, { bg: FACE_PAPER, line: true, round: true }),
      L("pupil", 70, 52, 28, 28, { bg: FACE_INK, round: true }),
      ...[0, 1, 2, 3, 4].map(i => L(`t${i}`, 30 + i * 24, 116, 16, 16, { bg: FACE_INK })),
    ] },
  { name: "quilt",
    bg: () => FACE_PAPER,
    layers: (c) => [
      L("q1", 0, 0, 80, 80, { bg: c[0] }),
      L("q2", 80, 0, 80, 80, { bg: c[1] }),
      L("q3", 0, 80, 80, 80, { bg: c[2] }),
      L("q4", 80, 80, 80, 80, { bg: c[0] }),
      L("eyeS", 26, 30, 26, 26, { bg: FACE_INK }),
      L("eyeC", 106, 30, 26, 26, { bg: FACE_INK, round: true }),
      L("mouth", 26, 108, 108, 14, { bg: FACE_INK }),
    ] },
  { name: "dome",
    bg: () => FACE_PAPER,
    layers: (c) => [
      L("dome", 18, 34, 120, 120, { bg: c[0], line: true, radius: "60px 60px 0 0" }),
      L("eyeL", 44, 74, 24, 24, { bg: FACE_PAPER, line: true }),
      L("eyeR", 88, 74, 24, 24, { bg: FACE_PAPER, line: true }),
      L("mouth", 56, 120, 44, 10, { bg: c[1] }),
    ] },
  { name: "prism",
    bg: (c) => `linear-gradient(135deg, ${c[0]} 0 50%, ${c[1]} 50% 100%)`,
    layers: () => [
      L("eyeL", 26, 50, 30, 30, { bg: FACE_PAPER, line: true, round: true }),
      L("eyeR", 100, 50, 30, 30, { bg: FACE_PAPER, line: true, round: true }),
      L("mouth", 44, 108, 68, 20, { bg: FACE_PAPER, line: true }),
    ] },
  // the one face in the kit that spends four palette colours rather than three
  { name: "stack",
    bg: (c) => c[0],
    layers: (c) => [
      L("b1", 22, 22, 104, 16, { bg: c[1], line: true }),
      L("b2", 22, 48, 64, 16, { bg: FACE_PAPER, line: true }),
      L("b3", 22, 74, 88, 16, { bg: c[2], line: true }),
      L("b4", 22, 100, 44, 16, { bg: c[3], line: true }),
      L("dot", 120, 120, 24, 24, { bg: FACE_INK, round: true }),
    ] },
  { name: "target",
    bg: (c) => c[0],
    layers: (c) => [
      L("o", 22, 22, 116, 116, { bg: FACE_PAPER, line: true }),
      L("m", 42, 42, 76, 76, { bg: c[1], line: true }),
      L("i", 63, 63, 34, 34, { bg: FACE_INK }),
    ] },
  { name: "pixel",
    bg: () => FACE_PAPER,
    layers: (c) => {
      const cells = [
        c[0], null, null, c[0],
        null, FACE_INK, FACE_INK, null,
        c[1], null, null, c[1],
        null, c[2], c[2], null,
      ];
      return cells.map((fill, i) => fill && L(`p${i}`,
        (i % 4) * 40, Math.floor(i / 4) * 40, 40, 40, { bg: fill })).filter(Boolean);
    } },
];

/* ---------- Your negotiator ----------
   One agent negotiates for you, and it has one identity: a name derived from
   yours and a single picture. The runtimes on the agents page (hermes, claude
   code) are where it *runs*, not who it is, they keep their vendor tiles.
   Everything the negotiator says anywhere in the app wears this picture. */
/* The record for whoever is signed in. Signing in replaces
   window.INDEX_DATA.ME wholesale with the live user, while the demo `ME` const
   stays as it was, so reading the const directly would keep naming the agent
   after the demo profile. */
function currentMe() {
  const live = (typeof window !== "undefined" && window.INDEX_DATA && window.INDEX_DATA.ME) || null;
  return live || (typeof ME !== "undefined" && ME) || {};
}

/* Where a shuffled face is kept.

   The page is loaded from a file:// URL, so WebKit hands the document an
   opaque origin and localStorage is not persisted between launches. The native
   shell stores it in UserDefaults instead and injects it at document start, so
   the saved face is already correct on the first paint. localStorage is still
   written as the fallback for running this bundle in a browser, where there is
   no shell to ask. */
const AGENT_FACE_KEY = "index.agentFace";
let agentFaceCache;

function storedAgentFace() {
  if (agentFaceCache !== undefined) return agentFaceCache;
  const native = (typeof window !== "undefined" && window.INDEX_NATIVE && window.INDEX_NATIVE.agentFace) || null;
  if (native) { agentFaceCache = native; return agentFaceCache; }
  try {
    const raw = window.localStorage.getItem(AGENT_FACE_KEY);
    agentFaceCache = raw ? JSON.parse(raw) : null;
  } catch (e) {
    agentFaceCache = null;   // storage disabled; the face falls back to your name
  }
  return agentFaceCache;
}

/** Save the negotiator's avatar so it survives a relaunch. */
function setMyAgentFace(patch) {
  const next = { ...(storedAgentFace() || {}), ...patch };
  agentFaceCache = next;
  Object.assign(currentMe(), {
    agentFaceSeed: next.seed || null,
    agentPhoto: next.photo || null,
  });
  try { window.localStorage.setItem(AGENT_FACE_KEY, JSON.stringify(next)); } catch (e) {}
  const bridge = (typeof window !== "undefined" && window.webkit
    && window.webkit.messageHandlers && window.webkit.messageHandlers.indexAuth) || null;
  if (bridge) {
    try { bridge.postMessage({ action: "setAgentFace", value: next }); } catch (e) {}
  }
  return next;
}

function myAgent() {
  const me = currentMe();
  const saved = storedAgentFace() || {};
  const first = String(me.name || "").trim().split(/\s+/)[0] || "your";
  return {
    name: `${first}'s agent`,
    // a shuffle wins, then whatever was saved on a previous run, and failing
    // both the face hangs off your name so it is yours from the first launch
    seed: me.agentFaceSeed || saved.seed || me.name || "index",
    photo: me.agentPhoto || saved.photo || null,
  };
}

/** Back-compat alias for the seed alone. */
function ownAgentSeed() { return myAgent().seed; }

/** Just the agent's own mark, no owner attached. */
function AgentMark({ size, agent, title }) {
  if (agent.photo) {
    return (
      <span title={title} style={{
        width:size, height:size, display:"block", flex:"0 0 auto",
        border:`1px solid ${FACE_INK}`, overflow:"hidden", boxSizing:"border-box",
      }}>
        <img src={agent.photo} alt="" style={{
          width:"100%", height:"100%", objectFit:"cover", display:"block",
        }}/>
      </span>
    );
  }
  return <AgentFace seed={agent.seed} size={size} title={title}/>;
}

/** Your negotiator's picture: your face with its mark set into the corner.
    An agent is not a separate character in the network, it is you with
    something acting on your behalf, so the picture says both. Your photo
    carries who it speaks for and the mark says it is the agent speaking. One
    component, so a change on the agents page lands everywhere at once. */
function MyAgentAvatar({ size = 22, style, title }) {
  const me = myAgent();
  const owner = currentMe();
  // The mark keeps a floor, since below about 8px the faces stop being marks
  // and become specks. The ring scales too: a fixed 1.5px halo is invisible at
  // 54px and swallows the mark at 16px.
  const badge = Math.max(8, Math.round(size * 0.44));
  const ring = Math.max(1, Math.round(size * 0.055 * 10) / 10);
  return (
    <div
      title={title || me.name}
      style={{ position:"relative", width:size, height:size, flex:"0 0 auto", ...style }}>
      {owner.photo ? (
        <img src={owner.photo} alt="" style={{
          width:"100%", height:"100%", objectFit:"cover", display:"block",
          border:`1px solid ${FACE_INK}`, boxSizing:"border-box",
          filter:"grayscale(1) contrast(1.05)",
        }}/>
      ) : (
        <Avatar name={owner.name} size={size}/>
      )}
      {/* bottom-right, held inside the footprint so the mark never overlaps
          whatever sits beside it in a tight row */}
      <span style={{
        position:"absolute", right:0, bottom:0, display:"block", lineHeight:0,
        boxShadow:`0 0 0 ${ring}px ${A.paper}`,
      }}>
        <AgentMark size={badge} agent={me}/>
      </span>
    </div>
  );
}

/** Deterministic face + palette draw for an owner. */
function agentFaceFor(seed) {
  const rnd = faceRandom(seed);
  const face = AGENT_FACES[Math.floor(rnd() * AGENT_FACES.length)] || AGENT_FACES[0];
  const pool = AGENT_FACE_PALETTE.slice();
  const c = [];
  while (c.length < 4 && pool.length) c.push(pool.splice(Math.floor(rnd() * pool.length), 1)[0]);
  return { face, colors: c };
}

/** One face, drawn at any size.
    The keyline stays on the unscaled wrapper rather than riding the transform:
    scaling a 2px border down to a 22px avatar would leave a 0.27px smear, and
    the outline is the one part of the mark that has to stay crisp. */
function AgentFace({ seed, size = 22, title, style }) {
  const { face, colors } = agentFaceFor(seed);
  const scale = size / FACE_UNIT;
  return (
    <div
      title={title}
      style={{
        width:size, height:size, flex:"0 0 auto", boxSizing:"border-box",
        position:"relative", overflow:"hidden",
        border:`${size >= 40 ? 2 : 1}px solid ${FACE_INK}`,
        background: face.bg(colors),
        ...style,
      }}>
      <div style={{
        position:"absolute", left:0, top:0,
        width:FACE_UNIT, height:FACE_UNIT,
        transform:`scale(${scale})`, transformOrigin:"top left",
      }}>
        {face.layers(colors).map(l => (
          <div key={l.key} style={{
            position:"absolute", boxSizing:"border-box",
            left:px(l.left), top:px(l.top), width:px(l.w), height:px(l.h),
            background: l.bg,
            border: l.line ? `2px solid ${FACE_INK}` : undefined,
            borderRadius: l.round ? "50%" : l.radius,
            display: l.innerRow ? "flex" : undefined,
            alignItems: l.innerRow ? "center" : undefined,
            justifyContent: l.innerRow ? "space-around" : undefined,
          }}>
            {l.inner && l.inner.map(inner => (
              <div key={inner.key} style={{
                width:px(inner.w), height:px(inner.h), background: inner.bg, flex:"0 0 auto",
              }}/>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

function AgentAvatar({ size = 22, collective = false, seed, title, style }) {
  // Every single agent gets a face. Named ones draw from their owner; a
  // counterpart the API could not name still gets a stable face rather than a
  // different-looking generic mark, so the app never mixes two visual
  // languages for the same kind of thing. Only "several agents at once" is
  // drawn differently, because it is not one agent.
  if (!collective) {
    return <AgentFace seed={seed || "someone"} size={size} title={title} style={style}/>;
  }
  return (
    <div
      title={title || (collective ? "several agents" : undefined)}
      aria-label={collective ? "several agents" : "agent"}
      style={{
        width:size, height:size, flex:"0 0 auto",
        display:"grid", placeItems:"center",
        border:`1px solid ${A.fg}`,
        background: collective ? A.fg : A.paper,
        boxShadow:"1px 1px 0 rgba(0,0,0,0.2)",
        ...style,
      }}>
      {collective ? (
        <span style={{
          fontFamily:"var(--mac-mono)", fontSize: Math.max(10, size * 0.55),
          fontWeight:700, lineHeight:1, color: A.paper,
        }}>⁂</span>
      ) : (
        <AgentGlyph size={Math.round(size * 0.64)}/>
      )}
    </div>
  );
}

/* ---------- Social links: one shape, whatever the source ----------
   Socials arrive two ways: the demo record carries {id, prefix, handle}, while
   the API carries {label, value} where value is usually a whole URL. Everything
   is normalized to a platform plus a bare handle, because the logo already says
   which platform it is: showing "x.com/seren" next to an X mark is the platform
   said twice. The prefix only comes back when a link has to be built. */
const SOCIAL_PREFIX = {
  x: "x.com/",
  twitter: "x.com/",
  linkedin: "linkedin.com/in/",
  github: "github.com/",
  telegram: "t.me/",
};

/** Platform id from an entry's own label, or failing that from its url. */
function socialPlatformOf(social = {}) {
  const id = String(social.id || social.label || social.platform || "").toLowerCase().trim();
  if (id) return id === "twitter" ? "x" : id;
  const p = String(social.prefix || social.handle || social.value || "").toLowerCase();
  if (p.includes("x.com") || p.includes("twitter")) return "x";
  if (p.includes("linkedin")) return "linkedin";
  if (p.includes("github")) return "github";
  if (p.includes("t.me") || p.includes("telegram")) return "telegram";
  return "website";
}

/** Just the part that identifies the person: no scheme, no platform host.
    An unknown host keeps its domain, since there the domain IS the identity. */
function socialHandleOf(social = {}) {
  const raw = String(social.handle ?? social.value ?? "").trim();
  if (!raw) return "";
  if (!/^https?:\/\//i.test(raw) && !raw.includes("/")) return raw.replace(/^@/, "");
  const bare = raw.replace(/^https?:\/\//i, "").replace(/^www\./i, "").replace(/\/+$/, "");
  const known = /^(x\.com|twitter\.com|linkedin\.com|github\.com|t\.me|telegram\.me)\/(in\/|@)?/i;
  return known.test(bare) ? bare.replace(known, "") : bare;
}

/** The address to open. Rebuilt from the platform when we only hold a handle. */
function socialHrefOf(social = {}) {
  const raw = String(social.handle ?? social.value ?? "").trim();
  if (/^https?:\/\//i.test(raw)) return raw;
  const handle = socialHandleOf(social);
  if (!handle) return "";
  const prefix = social.prefix || SOCIAL_PREFIX[socialPlatformOf(social)] || "";
  return `https://${prefix}${handle}`;
}

/** {id, prefix, handle} for editing, from any of the shapes above. */
function normalizeSocial(social = {}) {
  const id = socialPlatformOf(social);
  return { id, prefix: social.prefix || SOCIAL_PREFIX[id] || "", handle: socialHandleOf(social) };
}

/* ---------- SocialGlyph: 1-bit platform marks ----------
   Drawn rather than fetched: the bundle is offline, so a webfont or an SVG
   sprite from a CDN is not an option. Each is reduced to what survives at
   13px in one colour, the X cross, the "in" tile, the octocat silhouette as
   a head-and-tail, the telegram plane, a globe for anything else. */
// SVG mask ids are document-global, so each rendered glyph needs its own or
// they collide and every cat after the first renders against the wrong mask.
let maskSeq = 0;

function SocialGlyph({ id, size = 13, color = A.fg }) {
  const k = String(id || "").toLowerCase();
  const p = { width:size, height:size, viewBox:"0 0 16 16", style:{ display:"block", flex:"0 0 auto" } };
  if (k === "x" || k === "twitter") {
    return (
      <svg {...p} fill="none" stroke={color} strokeWidth={1.8} strokeLinecap="square">
        <line x1="3" y1="3" x2="13" y2="13"/>
        <line x1="13" y1="3" x2="3" y2="13"/>
      </svg>
    );
  }
  if (k === "linkedin") {
    return (
      <svg {...p} fill="none" stroke={color} strokeWidth={1.5}>
        <rect x="1.75" y="1.75" width="12.5" height="12.5"/>
        <rect x="4" y="6.5" width="1.8" height="5.5" fill={color} stroke="none"/>
        <rect x="4" y="3.9" width="1.8" height="1.8" fill={color} stroke="none"/>
        <path d="M7.6 12V6.5h1.8v.9c.4-.7 1.1-1 1.9-1 1.2 0 1.9.8 1.9 2.2V12h-1.8V8.9c0-.7-.3-1.1-.9-1.1s-1.1.5-1.1 1.2V12z"
          fill={color} stroke="none"/>
      </svg>
    );
  }
  if (k === "github" || k === "git" || k === "gitlab") {
    // The cat, drawn as a solid silhouette rather than an outline: at 13px a
    // 1.5px stroke closes up into mud, while a filled shape keeps its ears and
    // legs. The legs are punched out with a mask instead of being painted in a
    // paper colour, because this sits on white, on grey in the settings field,
    // and inverts to black when a profile link is hovered.
    const maskId = `gh-${maskSeq++}`;
    return (
      <svg {...p} fill="none">
        <mask id={maskId}>
          <rect width="16" height="16" fill="#000"/>
          <circle cx="8" cy="8.7" r="6.1" fill="#fff"/>
          <path d="M3.6 4.4C3.1 3.1 3.2 2.1 3.5 1.6c.7-.1 1.7.4 2.6 1.2z" fill="#fff"/>
          <path d="M12.4 4.4c.5-1.3.4-2.3.1-2.8-.7-.1-1.7.4-2.6 1.2z" fill="#fff"/>
          <path d="M6.05 15.2v-3.3h1.3v3.4z" fill="#000"/>
          <path d="M8.8 15.2v-2.9h1.3v3.0z" fill="#000"/>
        </mask>
        <rect width="16" height="16" fill={color} mask={`url(#${maskId})`}/>
        <path d="M3.75 11.9c-1.1-.3-1.5-1.25-1.5-1.25"
          stroke={color} strokeWidth={1.4} strokeLinecap="round"/>
      </svg>
    );
  }
  if (k === "telegram") {
    return (
      <svg {...p} fill="none" stroke={color} strokeWidth={1.4} strokeLinejoin="round">
        <path d="M14 2.5 1.8 7.4l3.4 1.2L13 3.6 6.6 9.9l-.2 3.4 2.1-2.4 3.3 2.3z"/>
      </svg>
    );
  }
  if (k === "email" || k === "mail") {
    return (
      <svg {...p} fill="none" stroke={color} strokeWidth={1.5}>
        <rect x="1.5" y="3.5" width="13" height="9"/>
        <path d="M1.5 4.2 8 9l6.5-4.8"/>
      </svg>
    );
  }
  // website and anything unrecognised
  return (
    <svg {...p} fill="none" stroke={color} strokeWidth={1.5}>
      <circle cx="8" cy="8" r="6.25"/>
      <ellipse cx="8" cy="8" rx="2.6" ry="6.25"/>
      <line x1="1.9" y1="8" x2="14.1" y2="8"/>
    </svg>
  );
}

/* ---------- RuleLabel: section header with rule ---------- */
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

/* ---------- PipelineFunnel: Amiga gadget strip ---------- */
// Label first, then its count in a badge. Each tab is sized to its own text
// rather than to an equal share of the row: five equal columns cut "awaiting
// you" down to "A…", and a tab whose name you cannot read is not a tab. If the
// whole strip still does not fit, it scrolls sideways rather than truncating.
function PipelineFunnel({ stages, mode = "broad", onClickStage, activeStage = "all" }) {
  const clickable = !!onClickStage;
  const allActive = activeStage === "all";
  return (
    <div style={{
      display:"flex", alignItems:"stretch", flexWrap:"wrap",
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
              flex:"0 0 auto",
              display:"flex", alignItems:"center", gap:5,
              padding:"7px 9px",
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
            }}>{s.label}</span>
            <span style={{
              fontSize:10, fontWeight:700, lineHeight:1,
              padding:"3px 4px", minWidth:14, textAlign:"center",
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

Object.assign(window, {
  LiveDot, StreamText, KV, Tag, Avatar, photoUrl,
  AgentGlyph, AgentAvatar, agentOwner, agentLabel, SocialGlyph, RuleLabel, Btn, Chip,
  SOCIAL_PREFIX, socialPlatformOf, socialHandleOf, socialHrefOf, normalizeSocial,
  AgentFace, agentFaceFor, ownAgentSeed, myAgent, MyAgentAvatar, setMyAgentFace, currentMe,
  AGENT_FACES, AGENT_FACE_PALETTE,
  ScoreBar, Ticker, Stat, useInterval,
  PipelineFunnel, SourceBadge, ModeBadge,
  MacWindow, MacSegmented, EditBadge, PicturePicker, PICTURE_MAX_BYTES,
  AMIGA_PALETTE: A,
});
