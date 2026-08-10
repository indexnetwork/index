// Networks, the communities you're in, and the ones you could join. Reached
// from the networks row on the hub's sidebar footer.

// Deterministic 2x2 tile standing in for the generative avatar. Same name
// always yields the same tile, so a network is recognisable by its colours.
// A network is a place, not a face: the flat palette and hard keyline sit with
// the rest of the chrome, where a bauhaus portrait read as a person.
function NetworkTile({ id, name, size = 36, photo }) {
  if (photo) {
    return (
      <img
        src={photo}
        alt=""
        style={{
          flex:"0 0 auto", width:size, height:size,
          objectFit:"cover", display:"block",
          border:"1px solid #000",
          // same treatment as every other photo in the app
          filter:"grayscale(1) contrast(1.05)",
        }}/>
    );
  }
  const PAL = ["#FF8A00", "#0055AA", "#C64B8C", "#3E8E7E", "#E8C547", "#7B5EA7"];
  const seed = String(name || id || "");
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  // unsigned shift, a signed one goes negative on bit 31 and indexes off the end
  const cells = [0, 1, 2, 3].map(i => PAL[(h >>> (i * 3)) % PAL.length]);
  return (
    <span style={{
      flex:"0 0 auto", width:size, height:size,
      border:"1px solid #000",
      display:"grid", gridTemplateColumns:"1fr 1fr", gridTemplateRows:"1fr 1fr",
    }}>
      {cells.map((c, i) => <span key={i} style={{ background:c }}/>)}
    </span>
  );
}

// The tile is generated from the name; this lets you replace it with an image.
// Same picker as the profile photo, see PicturePicker in primitives.
function NetworkPhoto({ name, photo, onPick, size = 42 }) {
  const [err, setErr] = useState("");

  return (
    <span style={{ display:"flex", alignItems:"center", gap:13, minWidth:0 }}>
      <PicturePicker size={size} label="change network picture" onPick={onPick} onError={setErr}>
        <NetworkTile id={name} name={name || "?"} size={size} photo={photo}/>
      </PicturePicker>

      {err && (
        <span style={{
          fontFamily:"var(--mac-sans)", fontSize:11, color:"var(--ink-warn)",
        }}>{err}</span>
      )}
    </span>
  );
}

// Static status label, same quiet fill as QuietChip, but no hover and no
// pointer, because membership is a state you're in, not an action here.
// Leaving lives on the network's own page.
function QuietTag({ children }) {
  return (
    <span style={{
      flex:"0 0 auto", padding:0,
      color:"var(--ink-3)",
      fontFamily:"var(--mac-mono)", fontSize:13,
    }}>{children}</span>
  );
}

// Raised gadget, bordered with a hard shadow, so it reads as pressable at a
// glance. Grey-on-grey chips read as disabled; this doesn't.
function ActionButton({ children, onClick, title, disabled }) {
  const [hover, setHover] = useState(false);
  return (
    <button
      onClick={onClick}
      title={title}
      disabled={disabled}
      onMouseEnter={() => !disabled && setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        flex:"0 0 auto", padding:"6px 14px", cursor: disabled ? "default" : "pointer",
        border:"1px solid #000",
        background: disabled ? "#F2F0EC" : (hover ? "#000" : "#fff"),
        color: disabled ? "var(--ink-2)" : (hover ? "#fff" : "#000"),
        boxShadow: disabled ? "none" : "1px 1px 0 rgba(0,0,0,0.2)",
        fontFamily:"var(--mac-mono)", fontSize:13, fontWeight:600,
      }}>{children}</button>
  );
}

// Quiet chip. Reads as secondary, but it IS a button, the hover invert is what
// distinguishes it from a static label.
function QuietChip({ children, onClick, title }) {
  const hover = (on) => (e) => {
    e.currentTarget.style.background = on ? "#000" : "#F2F0EC";
    e.currentTarget.style.color = on ? "#FF8A00" : "var(--ink-2)";
  };
  return (
    <button
      onClick={onClick}
      title={title}
      onMouseEnter={hover(true)}
      onMouseLeave={hover(false)}
      style={{
        flex:"0 0 auto", padding:"7px 15px", cursor:"pointer",
        border:"none", background:"#F2F0EC", color:"var(--ink-2)",
        fontFamily:"var(--mac-mono)", fontSize:13,
      }}>{children}</button>
  );
}

// One selectable option in the type/access groups. A filled accent square is
// the selected mark, same accent MacSegmented uses, plus the pressed inset
// shadow, so selection reads without flooding a whole card in orange. No
// leading icon: the square already carries the state, and a glyph beside it
// was decoration (the lock rendered as a colour emoji, off-palette).
function ChoiceCard({ title, sub, selected, onClick }) {
  return (
    <button
      onClick={onClick}
      aria-pressed={selected}
      style={{
        display:"flex", alignItems:"flex-start", gap:11,
        width:"100%", textAlign:"left",
        padding:"10px 12px", cursor:"pointer",
        border:"1px solid #000",
        background: selected ? "#F2EFE6" : "#fff",
        boxShadow: selected
          ? "inset 1px 1px 0 rgba(0,0,0,0.25)"
          : "1px 1px 0 rgba(0,0,0,0.2)",
      }}>
      <span style={{
        flex:"0 0 auto", width:13, height:13, marginTop:2,
        border:"1px solid #000",
        background: selected ? "#FF8A00" : "#fff",
        boxShadow: selected ? "inset 1px 1px 0 rgba(0,0,0,0.3)" : "none",
      }}/>
      <span style={{ display:"grid", gap:2, minWidth:0 }}>
        <span style={{
          fontFamily:"var(--mac-mono)", fontSize:13, fontWeight:600, color:"#000",
        }}>{title}</span>
        {sub && <span style={{
          fontFamily:"var(--mac-sans)", fontSize:12, color:"var(--ink-2)",
        }}>{sub}</span>}
      </span>
    </button>
  );
}

