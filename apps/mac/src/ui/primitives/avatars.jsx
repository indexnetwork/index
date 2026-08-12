/* ---------- Avatar: circular, web-parity boring-avatars bauhaus fallback ---------- */
const BORING_PALETTE = ["#92A1C6", "#146A7C", "#F0AB3D", "#C271B4", "#C20D90"];

function baHash(name) {
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = (hash << 5) - hash + name.charCodeAt(i);
    hash = hash & hash;
  }
  return Math.abs(hash);
}

function baDigit(num, ntn) {
  return Math.floor((num / Math.pow(10, ntn)) % 10);
}

function baBool(num, ntn) {
  return !(baDigit(num, ntn) % 2);
}

function baUnit(num, range, index) {
  const value = num % range;
  if (index && baDigit(num, index) % 2 === 0) return -value;
  return value;
}

function baColor(num) {
  return BORING_PALETTE[num % BORING_PALETTE.length];
}

function BoringAvatar({ seed, size = 28 }) {
  const SIZE = 80;
  const ELEMENTS = 4;
  const s = String(seed || "default");
  const num = baHash(s);
  const props_ = [];
  for (let t = 0; t < ELEMENTS; t++) {
    props_.push({
      color: baColor(num + t),
      translateX: baUnit(num * (t + 1), SIZE / 2 - (t + 17), 1),
      translateY: baUnit(num * (t + 1), SIZE / 2 - (t + 17), 2),
      rotate: baUnit(num * (t + 1), 360),
      isSquare: baBool(num, 2),
    });
  }
  const maskId = "ba-mask-" + num;
  return (
    <svg
      viewBox={`0 0 ${SIZE} ${SIZE}`}
      fill="none"
      role="img"
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      style={{ display:"block" }}
    >
      <mask id={maskId} maskUnits="userSpaceOnUse" x={0} y={0} width={SIZE} height={SIZE}>
        <rect width={SIZE} height={SIZE} rx={0} fill="#FFFFFF"/>
      </mask>
      <g mask={`url(#${maskId})`}>
        <rect width={SIZE} height={SIZE} fill={props_[0].color}/>
        <rect
          x={(SIZE - 60) / 2}
          y={(SIZE - 20) / 2}
          width={SIZE}
          height={props_[1].isSquare ? SIZE : SIZE / 8}
          fill={props_[1].color}
          transform={`translate(${props_[1].translateX} ${props_[1].translateY}) rotate(${props_[1].rotate} ${SIZE / 2} ${SIZE / 2})`}
        />
        <circle
          cx={SIZE / 2}
          cy={SIZE / 2}
          fill={props_[2].color}
          r={SIZE / 5}
          transform={`translate(${props_[2].translateX} ${props_[2].translateY})`}
        />
        <line
          x1={0}
          y1={SIZE / 2}
          x2={SIZE}
          y2={SIZE / 2}
          strokeWidth={2}
          stroke={props_[3].color}
          transform={`translate(${props_[3].translateX} ${props_[3].translateY}) rotate(${props_[3].rotate} ${SIZE / 2} ${SIZE / 2})`}
        />
      </g>
    </svg>
  );
}

function Avatar({ id, name, photo, size = 28, ring = false, blur = false }) {
  const seed = id || name || "default";
  const src = photo
    ? (window.IndexApp && window.IndexApp.avatarUrl ? window.IndexApp.avatarUrl(photo) : photo)
    : null;
  const [broken, setBroken] = useState(null);
  const frameStyle = {
    width: size,
    height: size,
    overflow: "hidden",
    flex: "0 0 auto",
    boxShadow: ring ? `0 0 0 2px ${A.accent}, 0 0 0 3px ${A.fg}` : undefined,
    filter: blur ? "blur(3px)" : undefined,
  };
  if (!src || broken === src) {
    return (
      <div style={frameStyle}>
        <BoringAvatar seed={seed} size={size}/>
      </div>
    );
  }
  return (
    <div style={frameStyle}>
      <img
        src={src}
        alt={name}
        onError={() => setBroken(src)}
        style={{ width:"100%", height:"100%", objectFit:"cover", display:"block" }}
      />
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
/* The record for whoever is signed in. applyLoaded sets window.INDEX_DATA.ME to
   the live user once the snapshot loads; live-only, so it is empty until then. */
function currentMe() {
  return (typeof window !== "undefined" && window.INDEX_DATA && window.INDEX_DATA.ME) || {};
}

function myAgent() {
  const me = currentMe();
  const first = String(me.name || "").trim().split(/\s+/)[0] || "your";
  return {
    name: `${first}'s agent`,
    // The face hangs off your account id, so it is the same on every device
    // and every launch, with nothing stored anywhere. Name is the fallback
    // until the snapshot loads.
    seed: me.id || me.name || "index",
    photo: null,
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
        }}/>
      ) : (
        <Avatar id={owner.id} name={owner.name} size={size}/>
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
