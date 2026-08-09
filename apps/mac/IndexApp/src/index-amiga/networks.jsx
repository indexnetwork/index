// Networks, the communities you're in, and the ones you could join. Reached
// from the networks row on the hub's sidebar footer.

// Deterministic 2x2 tile standing in for the generative avatar. Same name
// always yields the same tile, so a network is recognisable by its colours.
function NetworkTile({ name, size = 36, photo }) {
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
  let h = 0;
  for (let i = 0; i < (name || "").length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
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
        <NetworkTile name={name || "?"} size={size} photo={photo}/>
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
function ActionButton({ children, onClick, title }) {
  const [hover, setHover] = useState(false);
  return (
    <button
      onClick={onClick}
      title={title}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        flex:"0 0 auto", padding:"6px 14px", cursor:"pointer",
        border:"1px solid #000",
        background: hover ? "#000" : "#fff",
        color: hover ? "#fff" : "#000",
        boxShadow:"1px 1px 0 rgba(0,0,0,0.2)",
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

// Create-network sheet. Fields mirror the product spec: name, optional
// description, type, access. "Experiment" (headless API signup) is
// deliberately not offered here, existing networks may still carry it as a
// privacy value, but it isn't something you pick by hand.
function CreateNetwork({ onCancel, onCreate }) {
  const [name, setName]     = useState("");
  const [desc, setDesc]     = useState("");
  const [photo, setPhoto]   = useState(null);
  const [access, setAccess] = useState("private");

  const named = name.trim();
  const canCreate = named.length > 0;

  useEffect(() => {
    // capture + preventDefault: this form is on top of the networks window, so
    // Escape has to cancel the form rather than close the window under it
    const onKey = (e) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      onCancel();
    };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [onCancel]);

  const submit = () => {
    if (!canCreate) return;
    onCreate({ name: named, desc: desc.trim(), access, photo });
  };

  return (
    <div style={{
      position:"absolute", inset:0,
      display:"grid", placeItems:"center",
      gridTemplateColumns:"minmax(0, 1fr)",
      padding:"56px 40px", overflow:"auto",
    }}>
      {/* same frame as the list and the detail screen, so moving between them
          doesn't resize the window */}
      <div style={{
        width:860, maxWidth:"100%",
        height:"min(660px, calc(100vh - 112px))",
      }}>
        <MacWindow
          title="index · new network"
          onClose={onCancel}
          style={{ height:"100%", minHeight:0 }}>

          {/* header band, backs out to the list rather than reading as a
              separate screen. "← back" is the app-wide idiom (intents,
              onboarding), the destination is obvious, so naming it adds nothing */}
          <div style={{ padding:"14px 24px 16px", borderBottom:"2px solid #000" }}>
            <button
              onClick={onCancel}
              style={{
                padding:0, border:"none", background:"transparent", cursor:"pointer",
                fontFamily:"var(--mac-mono)", fontSize:12, color:"var(--ink-2)",
              }}>← back</button>

            <div style={{
              marginTop:12,
              fontFamily:"var(--mac-sans)", fontSize:13, color:"#000",
            }}>a network is a group that shares signals. name it, then say who can get in.</div>
          </div>

          <div className="mac-scroll" style={{
            flex:"1 1 auto", minHeight:0, overflowY:"auto",
            padding:"20px 24px 22px",
          }}>

            {/* live preview. picture is optional; without one the tile is
                derived from the name so the network still has a mark */}
            <div style={{ display:"flex", alignItems:"center", gap:13, marginBottom:20 }}>
              <NetworkPhoto name={named} photo={photo} onPick={setPhoto} size={42}/>
              <span style={{ display:"grid", gap:2, minWidth:0 }}>
                <span style={{
                  fontFamily:"var(--mac-mono)", fontSize:17, fontWeight:600,
                  color: named ? "#000" : "var(--ink-4)",
                  overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap",
                }}>{named || "network name"}</span>
                <span style={{
                  fontFamily:"var(--mac-mono)", fontSize:10, color:"var(--ink-3)",
                }}>picture optional</span>
              </span>
            </div>

            {/* one column at this width, like name/location on the profile.
                a full-860 name field is far more room than the value needs */}
            <div style={{ display:"grid", gridTemplateColumns:"minmax(0, 1fr) minmax(0, 1fr)", gap:"14px 18px" }}>
              <TextField
                label="name" required
                value={name}
                onChange={setName}
                placeholder="network name"
              />
            </div>

            <div style={{ marginTop:14 }}>
              <FieldLabel right={
                <span style={{
                  fontFamily:"var(--mac-mono)", fontSize:10, color:"var(--ink-3)",
                }}>optional</span>
              }>description</FieldLabel>
              <div style={{ ...wellStyle(false), alignItems:"stretch" }}>
                <textarea
                  value={desc}
                  onChange={e => setDesc(e.target.value)}
                  placeholder="what people can share in this network…"
                  rows={3}
                  style={{ ...inputReset(false), resize:"vertical", lineHeight:1.5 }}
                />
              </div>
            </div>

            <SectionRule>access</SectionRule>
            <div style={{
              marginTop:12, display:"grid",
              gridTemplateColumns:"minmax(0, 1fr) minmax(0, 1fr)", gap:"8px 14px",
            }}>
              <ChoiceCard
                title="public"
                sub="anyone can discover and join"
                selected={access === "public"}
                onClick={() => setAccess("public")}
              />
              <ChoiceCard
                title="private"
                sub="only people with an invitation link"
                selected={access === "private"}
                onClick={() => setAccess("private")}
              />
            </div>
          </div>

          <div style={{
            borderTop:"2px solid #000", padding:"11px 24px",
            display:"flex", alignItems:"center", justifyContent:"flex-end", gap:10,
          }}>
            <button
              onClick={onCancel}
              style={{
                fontFamily:"var(--mac-mono)", fontSize:13, padding:"7px 17px",
                border:"1px solid #000", background:"#fff", color:"#000",
                boxShadow:"1px 1px 0 rgba(0,0,0,0.2)", cursor:"pointer",
              }}>cancel</button>
            <button
              onClick={submit}
              disabled={!canCreate}
              title={canCreate ? undefined : "give the network a name first"}
              style={{
                fontFamily:"var(--mac-mono)", fontSize:13, padding:"7px 19px",
                border:"1px solid #000",
                background: canCreate ? "#000" : "#EDEAE1",
                color: canCreate ? "#fff" : "var(--ink-3)",
                boxShadow:"1px 1px 0 rgba(0,0,0,0.2)",
                cursor: canCreate ? "pointer" : "default",
                fontWeight:700,
              }}>create</button>
          </div>
        </MacWindow>
      </div>
    </div>
  );
}

// Rough-size brackets for the request form. Match the web modal's options so
// the same question reads the same on every surface.
const NET_SIZE_OPTIONS = ["Under 100", "100 – 1K", "1K – 10K", "10K+"];

// Early-access "request a network" screen. Same fields as CreateNetwork
// (picture, name, description, access) plus expected size. Submits to
// /network-requests instead of creating a live network. Also handles
// resubmitting a "needs changes" request when `initial` is passed.
function RequestNetwork({ initial, onCancel, onSubmit }) {
  const initialPhoto = initial && initial.imageUrl
    ? (window.IndexApp && window.IndexApp.avatarUrl
      ? window.IndexApp.avatarUrl(initial.imageUrl)
      : initial.imageUrl)
    : null;
  const [name, setName]     = useState((initial && initial.title) || "");
  const [desc, setDesc]     = useState((initial && initial.purpose) || "");
  const [photo, setPhoto]   = useState(initialPhoto);
  const [access, setAccess] = useState(
    initial && initial.joinPolicy === "anyone" ? "public" : "private",
  );
  const [size, setSize]     = useState((initial && initial.expectedSize) || "");
  const [sending, setSending] = useState(false);
  const [done, setDone]       = useState(null);

  const named = name.trim();
  const canSend = named.length > 0 && !sending;
  const isEdit = !!initial;

  useEffect(() => {
    const onKey = (e) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      onCancel();
    };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [onCancel]);

  const submit = () => {
    if (!canSend) return;
    setSending(true);
    Promise.resolve(onSubmit({
      name: named,
      purpose: desc.trim() || undefined,
      expectedSize: size || undefined,
      joinPolicy: access === "public" ? "anyone" : "invite_only",
      photo,
    }))
      .then((req) => setDone(req || { title: named }))
      .catch(() => {})
      .finally(() => setSending(false));
  };

  return (
    <div style={{
      position:"absolute", inset:0,
      display:"grid", placeItems:"center",
      gridTemplateColumns:"minmax(0, 1fr)",
      padding:"56px 40px", overflow:"auto",
    }}>
      <div style={{
        width:860, maxWidth:"100%",
        height:"min(720px, calc(100vh - 112px))",
      }}>
        <MacWindow
          title="index · request a network"
          onClose={onCancel}
          style={{ height:"100%", minHeight:0 }}>

          {done ? (
            <div style={{
              flex:"1 1 auto", minHeight:0, overflowY:"auto",
              display:"grid", placeItems:"center", padding:"40px 32px", textAlign:"center",
            }}>
              <div>
                <div style={{
                  margin:"0 auto 16px", width:40, height:40, border:"1px solid #000",
                  display:"grid", placeItems:"center", background:"#F2EFE6",
                  fontFamily:"var(--mac-mono)", fontSize:20, color:"#000",
                }}>✓</div>
                <div style={{
                  fontFamily:"var(--mac-mono)", fontSize:17, fontWeight:700, color:"#000", marginBottom:8,
                }}>your request is in</div>
                <div style={{
                  fontFamily:"var(--mac-sans)", fontSize:13, color:"var(--ink-2)", maxWidth:360, margin:"0 auto",
                }}>
                  we&apos;re reviewing <b style={{ color:"#000" }}>{(done && done.title) || named}</b> and
                  will get back to you shortly.
                </div>
                <div style={{ marginTop:22 }}>
                  <ActionButton onClick={onCancel}>back to networks</ActionButton>
                </div>
              </div>
            </div>
          ) : (
            <>
              <div style={{ padding:"14px 24px 16px", borderBottom:"2px solid #000" }}>
                <button
                  onClick={onCancel}
                  style={{
                    padding:0, border:"none", background:"transparent", cursor:"pointer",
                    fontFamily:"var(--mac-mono)", fontSize:12, color:"var(--ink-2)",
                  }}>← back</button>

                <div style={{
                  marginTop:12, padding:"9px 12px",
                  border:"1px solid #000", borderLeft:"3px solid #FF8A00",
                  background:"#F2EFE6",
                  fontFamily:"var(--mac-sans)", fontSize:13, color:"#000",
                }}>network creation is still early. fill this in and we&apos;ll review it before it goes live.</div>
              </div>

              <div className="mac-scroll" style={{
                flex:"1 1 auto", minHeight:0, overflowY:"auto",
                padding:"20px 24px 22px",
              }}>
                <div style={{ display:"flex", alignItems:"center", gap:13, marginBottom:20 }}>
                  <NetworkPhoto name={named} photo={photo} onPick={setPhoto} size={42}/>
                  <span style={{ display:"grid", gap:2, minWidth:0 }}>
                    <span style={{
                      fontFamily:"var(--mac-mono)", fontSize:17, fontWeight:600,
                      color: named ? "#000" : "var(--ink-4)",
                      overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap",
                    }}>{named || "network name"}</span>
                    <span style={{
                      fontFamily:"var(--mac-mono)", fontSize:10, color:"var(--ink-3)",
                    }}>picture optional</span>
                  </span>
                </div>

                <div style={{ display:"grid", gridTemplateColumns:"minmax(0, 1fr) minmax(0, 1fr)", gap:"14px 18px" }}>
                  <TextField
                    label="name" required
                    value={name}
                    onChange={setName}
                    placeholder="network name"
                  />
                </div>

                <div style={{ marginTop:14 }}>
                  <FieldLabel right={
                    <span style={{
                      fontFamily:"var(--mac-mono)", fontSize:10, color:"var(--ink-3)",
                    }}>optional</span>
                  }>description</FieldLabel>
                  <div style={{ ...wellStyle(false), alignItems:"stretch" }}>
                    <textarea
                      value={desc}
                      onChange={e => setDesc(e.target.value)}
                      placeholder="what people can share in this network…"
                      rows={3}
                      style={{ ...inputReset(false), resize:"vertical", lineHeight:1.5 }}
                    />
                  </div>
                </div>

                <SectionRule>access</SectionRule>
                <div style={{
                  marginTop:12, display:"grid",
                  gridTemplateColumns:"minmax(0, 1fr) minmax(0, 1fr)", gap:"8px 14px",
                }}>
                  <ChoiceCard
                    title="public"
                    sub="anyone can discover and join"
                    selected={access === "public"}
                    onClick={() => setAccess("public")}
                  />
                  <ChoiceCard
                    title="private"
                    sub="only people with an invitation link"
                    selected={access === "private"}
                    onClick={() => setAccess("private")}
                  />
                </div>

                <SectionRule>how many people are you hoping to bring together?</SectionRule>
                <div style={{
                  marginTop:12, display:"grid",
                  gridTemplateColumns:"minmax(0, 1fr) minmax(0, 1fr)", gap:"8px 14px",
                }}>
                  {NET_SIZE_OPTIONS.map(opt => (
                    <ChoiceCard
                      key={opt}
                      title={opt}
                      selected={size === opt}
                      onClick={() => setSize(size === opt ? "" : opt)}
                    />
                  ))}
                </div>

                <div style={{
                  marginTop:16,
                  fontFamily:"var(--mac-sans)", fontSize:12, color:"var(--ink-3)",
                }}>every request is currently reviewed by the Index team.</div>
              </div>

              <div style={{
                borderTop:"2px solid #000", padding:"11px 24px",
                display:"flex", alignItems:"center", justifyContent:"flex-end", gap:10,
              }}>
                <button
                  onClick={onCancel}
                  style={{
                    fontFamily:"var(--mac-mono)", fontSize:13, padding:"7px 17px",
                    border:"1px solid #000", background:"#fff", color:"#000",
                    boxShadow:"1px 1px 0 rgba(0,0,0,0.2)", cursor:"pointer",
                  }}>cancel</button>
                <button
                  onClick={submit}
                  disabled={!canSend}
                  title={named ? undefined : "give the network a name first"}
                  style={{
                    fontFamily:"var(--mac-mono)", fontSize:13, padding:"7px 19px",
                    border:"1px solid #000",
                    background: canSend ? "#000" : "#EDEAE1",
                    color: canSend ? "#fff" : "var(--ink-3)",
                    boxShadow:"1px 1px 0 rgba(0,0,0,0.2)",
                    cursor: canSend ? "pointer" : "default",
                    fontWeight:700,
                  }}>{sending ? "sending…" : isEdit ? "resubmit" : "request network"}</button>
              </div>
            </>
          )}
        </MacWindow>
      </div>
    </div>
  );
}

// A pending / needs-changes request the signed-in user submitted. Shown above
// the joined networks on the "my networks" tab, mirroring the web page.
function RequestStatusRow({ req, onEdit, onDismiss }) {
  const needsChanges = req.status === "needs_changes";
  return (
    <div style={{
      display:"flex", alignItems:"flex-start", gap:12,
      padding:"10px 12px", borderBottom:"1px solid #DDD8CC",
    }}>
      <NetworkTile name={req.title} photo={
        req.imageUrl && window.IndexApp && window.IndexApp.avatarUrl
          ? window.IndexApp.avatarUrl(req.imageUrl)
          : req.imageUrl || undefined
      }/>
      <div style={{ flex:1, minWidth:0 }}>
        <div style={{ display:"flex", alignItems:"center", gap:8 }}>
          <span style={{
            fontFamily:"var(--mac-mono)", fontSize:15, fontWeight:700, color:"#000",
          }}>{req.title}</span>
          <span style={{
            fontFamily:"var(--mac-mono)", fontSize:11,
            color: needsChanges ? "var(--ink-warn)" : "var(--ink-3)",
          }}>{needsChanges ? "needs changes" : "in review"}</span>
        </div>
        {needsChanges && req.reviewNote
          ? <div style={{
              marginTop:4, fontFamily:"var(--mac-sans)", fontSize:12,
              color:"var(--ink-2)", fontStyle:"italic",
            }}>“{req.reviewNote}”</div>
          : <div style={{
              marginTop:2, fontFamily:"var(--mac-sans)", fontSize:13, color:"var(--ink-2)",
            }}>we&apos;re reviewing your request.</div>}
      </div>
      {needsChanges ? (
        <div style={{ display:"flex", alignItems:"center", gap:8, flex:"0 0 auto" }}>
          <QuietChip onClick={() => onDismiss(req.id)} title="dismiss this request">dismiss</QuietChip>
          <ActionButton onClick={() => onEdit(req)} title="update and resubmit">update</ActionButton>
        </div>
      ) : (
        <QuietChip onClick={() => onDismiss(req.id)} title="withdraw this request">withdraw</QuietChip>
      )}
    </div>
  );
}

function NetworkRow({ net, onOpen, onJoin }) {
  const [hover, setHover] = useState(false);
  return (
    <div
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        display:"flex", alignItems:"center", gap:12,
        padding:"10px 12px",
        borderBottom:"1px solid #DDD8CC",
        background: hover ? "#FAF8F3" : "transparent",
      }}>
      <NetworkTile name={net.name} photo={net.photo}/>

      <button
        onClick={() => onOpen && onOpen(net)}
        style={{
          flex:1, minWidth:0, textAlign:"left", padding:0,
          border:"none", background:"transparent", cursor:"pointer",
        }}>
        <span style={{
          display:"block",
          fontFamily:"var(--mac-mono)", fontSize:15, fontWeight:700, color:"#000",
        }}>{net.name}</span>
        <span style={{
          display:"block", marginTop:2,
          fontFamily:"var(--mac-sans)", fontSize:13, color:"var(--ink-2)",
        }}>{net.members} members</span>
      </button>

      {net.joined
        ? <QuietTag>{net.role || "member"}</QuietTag>
        : <ActionButton onClick={() => onJoin && onJoin(net)} title="ask to join">join</ActionButton>}
    </div>
  );
}

/* ---------- detail ---------- */

const MEMBERS_PAGE_SIZE = 10;

function MetaBit({ glyph, children }) {
  return (
    <span style={{
      display:"flex", alignItems:"center", gap:5,
      fontFamily:"var(--mac-mono)", fontSize:12, color:"var(--ink-2)",
    }}>
      <span aria-hidden="true">{glyph}</span>{children}
    </span>
  );
}

function formatSignalDate(iso) {
  if (!iso) return "";
  try {
    return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
  } catch (e) { return ""; }
}

function Signal({ sig, netName, onRemove, onOpen }) {
  const [hover, setHover] = useState(false);
  return (
    <div
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      onClick={() => onOpen && onOpen(sig)}
      style={{
        border:"1px solid #000", background:"#fff",
        boxShadow: hover ? "3px 3px 0 rgba(0,0,0,0.22)" : "2px 2px 0 rgba(0,0,0,0.22)",
        padding:"12px 14px",
        display:"flex", alignItems:"flex-start", gap:14,
        cursor: onOpen ? "pointer" : "default",
      }}>
      <div style={{ flex:1, minWidth:0, display:"grid", gap:9 }}>
        <div style={{
          fontFamily:"var(--mac-sans)", fontSize:13, lineHeight:1.5, color:"#000",
        }}>{sig.text}</div>
        <MetaBit glyph="▤">{sig.date}</MetaBit>
      </div>

      {onRemove && (
        <span
          title={`stop sharing this signal with ${netName}. it keeps running elsewhere`}
          style={{ flex:"0 0 auto" }}
          onClick={(e) => e.stopPropagation()}>
          <SignalAction label="− remove" onClick={() => onRemove(sig)}/>
        </span>
      )}
    </div>
  );
}

function MemberFace({ member, size = 28 }) {
  const photo = member.avatar
    ? (window.IndexApp && window.IndexApp.avatarUrl
      ? window.IndexApp.avatarUrl(member.avatar)
      : member.avatar)
    : null;
  if (photo) {
    return (
      <img
        src={photo}
        alt=""
        style={{
          flex:"0 0 auto", width:size, height:size, borderRadius:"50%",
          objectFit:"cover", border:"1px solid #000",
          filter: member.isGhost ? "grayscale(1) blur(1px)" : "grayscale(1) contrast(1.05)",
        }}/>
    );
  }
  const initials = String(member.name || "?")
    .split(/\s+/).filter(Boolean).slice(0, 2)
    .map(w => w[0]).join("").toLowerCase();
  return (
    <span style={{
      flex:"0 0 auto", width:size, height:size, borderRadius:"50%",
      border:"1px solid #000", background:"#F2F0EC",
      display:"flex", alignItems:"center", justifyContent:"center",
      fontFamily:"var(--mac-mono)", fontSize:10, color:"#000",
      filter: member.isGhost ? "blur(1px)" : "none",
    }}>{initials}</span>
  );
}

function NetworkMembers({ networkId, meId, members, setMembers, busy, setBusy }) {
  const live = !!(window.IndexApp && window.IndexApp.isAuthed());
  const client = live ? window.IndexApp.getClient() : null;
  const [query, setQuery] = useState("");
  const [suggestions, setSuggestions] = useState([]);
  const [showSug, setShowSug] = useState(false);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!live || !networkId) return;
    const c = window.IndexApp.getClient();
    if (!c) return;
    let cancelled = false;
    setLoading(true);
    c.networks.getMembers(networkId)
      .then((res) => {
        if (cancelled) return;
        setMembers((res && res.members) || []);
      })
      .catch(() => { if (!cancelled) setMembers([]); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [live, networkId]);

  useEffect(() => {
    if (!live || !query.trim()) { setSuggestions([]); return; }
    const c = window.IndexApp.getClient();
    if (!c) return;
    const t = setTimeout(() => {
      c.networks.searchUsers(query.trim(), networkId)
        .then((res) => {
          const users = (res && res.users) || (Array.isArray(res) ? res : []);
          const ids = new Set(members.map(m => m.id));
          setSuggestions(users.filter(u => u && u.id && !ids.has(u.id)));
          setShowSug(true);
        })
        .catch(() => setSuggestions([]));
    }, 220);
    return () => clearTimeout(t);
  }, [query, live, networkId, members]);

  const addUser = async (user) => {
    if (!client || busy) return;
    setBusy(true);
    try {
      const m = await client.networks.addMember(networkId, user.id, ["member"]);
      setMembers(prev => [...prev, m.member || m]);
      setQuery("");
      setSuggestions([]);
      setShowSug(false);
    } catch (e) { /* keep list */ }
    finally { setBusy(false); }
  };

  const inviteEmail = async (email) => {
    if (!client || busy) return;
    setBusy(true);
    try {
      await client.networks.inviteMember(networkId, { email });
      const res = await client.networks.getMembers(networkId);
      setMembers((res && res.members) || []);
      setQuery("");
      setSuggestions([]);
      setShowSug(false);
    } catch (e) { /* keep list */ }
    finally { setBusy(false); }
  };

  const remove = async (id) => {
    if (!client || busy) return;
    setBusy(true);
    try {
      await client.networks.removeMember(networkId, id);
      setMembers(prev => prev.filter(m => m.id !== id));
    } catch (e) { /* keep */ }
    finally { setBusy(false); }
  };

  const setRole = async (id, role) => {
    if (!client || busy) return;
    setBusy(true);
    try {
      const updated = await client.networks.updateMemberPermissions(
        networkId, id, role === "owner" ? ["owner"] : ["member"],
      );
      const m = updated.member || updated;
      setMembers(prev => prev.map(x => x.id === id ? { ...x, permissions: m.permissions || x.permissions } : x));
    } catch (e) { /* keep */ }
    finally { setBusy(false); }
  };

  const openProfile = (id) => {
    const base = (window.IndexApp && window.IndexApp.webBaseUrl
      ? window.IndexApp.webBaseUrl()
      : "https://index.network").replace(/\/+$/, "");
    window.open(`${base}/u/${encodeURIComponent(id)}`, "_blank", "noopener,noreferrer");
  };

  const totalPages = Math.max(1, Math.ceil(members.length / MEMBERS_PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const slice = members.slice((safePage - 1) * MEMBERS_PAGE_SIZE, safePage * MEMBERS_PAGE_SIZE);
  const noResults = showSug && query.trim() && !suggestions.length;

  return (
    <div>
      <RuleLabel>Members ({members.length})</RuleLabel>
      <div style={{ marginTop:12, position:"relative" }}>
        <input
          value={query}
          onChange={(e) => { setQuery(e.target.value); setShowSug(true); }}
          onFocus={() => setShowSug(true)}
          placeholder="Search by name or add by email…"
          style={{
            width:"100%", boxSizing:"border-box",
            padding:"9px 12px", border:"1px solid #000", background:"#fff",
            fontFamily:"var(--mac-mono)", fontSize:12, color:"#000",
          }}
        />
        {showSug && query.trim() && suggestions.length > 0 && (
          <div style={{
            position:"absolute", left:0, right:0, top:"100%", marginTop:2, zIndex:5,
            border:"1px solid #000", background:"#fff", maxHeight:160, overflowY:"auto",
            boxShadow:"2px 2px 0 rgba(0,0,0,0.2)",
          }}>
            {suggestions.map(u => (
              <button
                key={u.id}
                type="button"
                onClick={() => addUser(u)}
                style={{
                  width:"100%", display:"flex", alignItems:"center", gap:10,
                  padding:"8px 12px", border:"none", background:"transparent",
                  cursor:"pointer", textAlign:"left",
                  fontFamily:"var(--mac-sans)", fontSize:13, color:"#000",
                }}>
                <MemberFace member={u} size={24}/>
                <span style={{ flex:1, minWidth:0, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{u.name}</span>
                <span style={{ fontFamily:"var(--mac-mono)", fontSize:11, color:"var(--ink-2)" }}>Add</span>
              </button>
            ))}
          </div>
        )}
        {noResults && (
          <div style={{
            position:"absolute", left:0, right:0, top:"100%", marginTop:2, zIndex:5,
            border:"1px solid #000", background:"#fff",
            boxShadow:"2px 2px 0 rgba(0,0,0,0.2)",
          }}>
            {query.includes("@") ? (
              <button
                type="button"
                disabled={busy}
                onClick={() => inviteEmail(query.trim())}
                style={{
                  width:"100%", padding:"10px 12px", border:"none", background:"transparent",
                  cursor:"pointer", textAlign:"left",
                  fontFamily:"var(--mac-sans)", fontSize:13, color:"#000",
                }}>Invite &quot;{query.trim()}&quot;</button>
            ) : (
              <div style={{
                padding:"10px 12px", fontFamily:"var(--mac-mono)", fontSize:12, color:"var(--ink-2)",
              }}>No results found</div>
            )}
          </div>
        )}
      </div>

      <div style={{ marginTop:12, display:"grid", gap:2 }}>
        {loading && (
          <p style={{ fontFamily:"var(--mac-mono)", fontSize:12, color:"var(--ink-2)" }}>Loading members…</p>
        )}
        {!loading && slice.map(m => {
          const perms = Array.isArray(m.permissions) ? m.permissions : [];
          const isOwner = perms.includes("owner");
          const isSelf = meId && m.id === meId;
          return (
            <div
              key={m.id}
              style={{
                display:"flex", alignItems:"center", gap:10,
                padding:"8px 10px",
              }}>
              <button
                type="button"
                onClick={() => openProfile(m.id)}
                style={{
                  flex:1, minWidth:0, display:"flex", alignItems:"center", gap:10,
                  border:"none", background:"transparent", cursor:"pointer", textAlign:"left", padding:0,
                }}>
                <MemberFace member={m}/>
                <span style={{
                  fontFamily:"var(--mac-sans)", fontSize:13, color:"#000",
                  overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap",
                }}>
                  {m.name}
                  {m.isGhost && (
                    <span style={{
                      marginLeft:6, fontFamily:"var(--mac-mono)", fontSize:10, color:"var(--ink-3)",
                    }}>ghost</span>
                  )}
                </span>
              </button>
              <span style={{
                flex:"0 0 auto",
                fontFamily:"var(--mac-mono)", fontSize:11,
                padding:"2px 6px",
                background: isOwner ? "#000" : "#E8E6E1",
                color: isOwner ? "#fff" : "var(--ink-2)",
              }}>{isOwner ? "Owner" : (perms.includes("member") ? "Member" : "Contact")}</span>
              {!isOwner && perms.includes("member") && !isSelf && (
                <button type="button" title="Promote to owner" disabled={busy}
                  onClick={() => setRole(m.id, "owner")}
                  style={memberActStyle}>↑</button>
              )}
              {isOwner && !isSelf && (
                <button type="button" title="Demote to member" disabled={busy}
                  onClick={() => setRole(m.id, "member")}
                  style={memberActStyle}>↓</button>
              )}
              {!isOwner && (
                <button type="button" title="Remove member" disabled={busy}
                  onClick={() => remove(m.id)}
                  style={{ ...memberActStyle, color:"var(--ink-warn)" }}>×</button>
              )}
            </div>
          );
        })}
      </div>

      {totalPages > 1 && (
        <div style={{
          marginTop:12, display:"flex", alignItems:"center", justifyContent:"space-between",
          borderTop:"1px solid #ddd", paddingTop:10,
          fontFamily:"var(--mac-mono)", fontSize:11, color:"var(--ink-2)",
        }}>
          <span>
            {(safePage - 1) * MEMBERS_PAGE_SIZE + 1}–{Math.min(safePage * MEMBERS_PAGE_SIZE, members.length)} of {members.length}
          </span>
          <span style={{ display:"flex", gap:6 }}>
            <button type="button" disabled={safePage <= 1} onClick={() => setPage(safePage - 1)} style={memberActStyle}>prev</button>
            <button type="button" disabled={safePage >= totalPages} onClick={() => setPage(safePage + 1)} style={memberActStyle}>next</button>
          </span>
        </div>
      )}
    </div>
  );
}

const memberActStyle = {
  flex:"0 0 auto", cursor:"pointer",
  padding:"2px 8px", border:"1px solid #000", background:"#fff",
  fontFamily:"var(--mac-mono)", fontSize:11, color:"#000",
};

function networkShareUrl(net) {
  if (!net || net.isPersonal || net.hasMasterKey || !networkIsOwner(net)) return null;
  const base = (window.IndexApp && window.IndexApp.webBaseUrl
    ? window.IndexApp.webBaseUrl()
    : "https://index.network").replace(/\/+$/, "");
  if (net.joinPolicy === "anyone" && net.id) return `${base}/index/${encodeURIComponent(net.id)}`;
  if (net.invitationCode) return `${base}/l/${encodeURIComponent(net.invitationCode)}`;
  return null;
}

function networkIsOwner(net) {
  if (!net || net.isPersonal) return false;
  const role = net.role || (net.source && net.source.role);
  return role === "owner" || role === "admin";
}

function NetworkDetail({ net, onBack, onLeave, onUpdated, onDeleted, onOpenSignal }) {
  const [local, setLocal] = useState(net);
  const [signals, setSignals] = useState(net.signals || []);
  const [signalsLoading, setSignalsLoading] = useState(false);
  const [undo, setUndo] = useState(null);
  const isOwner = networkIsOwner(local);
  const [tab, setTab] = useState("overview");
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);
  const [members, setMembers] = useState([]);
  // settings draft
  const [title, setTitle] = useState(local.name || "");
  const [prompt, setPrompt] = useState(local.blurb || "");
  const [photo, setPhoto] = useState(local.photo || null);
  const [photoDirty, setPhotoDirty] = useState(false);
  const [removePhoto, setRemovePhoto] = useState(false);
  const [deleteText, setDeleteText] = useState("");
  const [showDelete, setShowDelete] = useState(false);
  const live = !!(window.IndexApp && window.IndexApp.isAuthed());
  const client = live ? window.IndexApp.getClient() : null;
  const meId = (window.INDEX_DATA && window.INDEX_DATA.ME && window.INDEX_DATA.ME.id) || null;
  const shareUrl = networkShareUrl(local);
  const isPublic = local.joinPolicy === "anyone";
  const settingsDirty = title !== (local.name || "") || prompt !== (local.blurb || "") || photoDirty || removePhoto;

  useEffect(() => {
    setLocal(net);
    setTitle(net.name || "");
    setPrompt(net.blurb || "");
    setPhoto(net.photo || null);
    setPhotoDirty(false);
    setRemovePhoto(false);
    if (networkIsOwner(net)) setTab((t) => (t === "overview" || t === "access" || t === "settings" ? t : "overview"));
  }, [net]);

  useEffect(() => {
    if (!client || !local.id) return;
    let cancelled = false;
    setSignalsLoading(true);
    client.networks.overview(local.id)
      .then((res) => {
        if (cancelled) return;
        const intents = (res && res.intents) || [];
        setSignals(intents.map(i => ({
          id: i.id,
          text: (i.summary && String(i.summary).trim()) || i.payload || "",
          date: formatSignalDate(i.createdAt),
          source: i,
        })));
      })
      .catch(() => {})
      .finally(() => { if (!cancelled) setSignalsLoading(false); });
    return () => { cancelled = true; };
  }, [client, local.id]);

  useEffect(() => {
    if (isOwner && typeof members.length === "number" && members.length > 0) {
      const merged = { ...local, members: members.length };
      if (local.members !== members.length) {
        setLocal(merged);
        if (onUpdated) onUpdated(merged);
      }
    }
  }, [members.length]); // eslint-disable-line react-hooks/exhaustive-deps

  const remove = (sig) => {
    const at = signals.findIndex(s => s.id === sig.id);
    setSignals(signals.filter(s => s.id !== sig.id));
    setUndo({ sig, at });
  };

  const putBack = () => {
    if (!undo) return;
    const next = [...signals];
    next.splice(undo.at, 0, undo.sig);
    setSignals(next);
    setUndo(null);
  };

  const copyLink = async () => {
    if (!shareUrl) return;
    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (e) { /* leave idle */ }
  };

  const setJoinPolicy = async (anyone) => {
    const next = anyone ? "anyone" : "invite_only";
    if (local.joinPolicy === next || busy) return;
    setBusy(true);
    const prev = local;
    const optimistic = {
      ...local,
      joinPolicy: next,
      privacy: anyone ? "public" : "private",
    };
    setLocal(optimistic);
    if (onUpdated) onUpdated(optimistic);
    try {
      if (client) {
        const res = await client.networks.updatePermissions(local.id, { joinPolicy: next });
        const n = (res && res.network) || res || {};
        const perms = n.permissions || {};
        const jp = perms.joinPolicy || next;
        const code = (perms.invitationLink && perms.invitationLink.code)
          || prev.invitationCode;
        const merged = {
          ...optimistic,
          joinPolicy: jp,
          privacy: jp === "anyone" ? "public" : "private",
          invitationCode: code || null,
        };
        setLocal(merged);
        if (onUpdated) onUpdated(merged);
      }
    } catch (e) {
      setLocal(prev);
      if (onUpdated) onUpdated(prev);
    } finally {
      setBusy(false);
    }
  };

  const saveSettings = async () => {
    if (!client || !title.trim() || busy) return;
    setBusy(true);
    try {
      let imageUrl = undefined;
      if (photoDirty && photo && /^data:/i.test(photo)) {
        imageUrl = await client.storage.uploadIndexImage(photo);
      } else if (removePhoto) {
        imageUrl = null;
      }
      const body = {
        title: title.trim(),
        prompt: prompt.trim() || null,
      };
      if (imageUrl !== undefined) body.imageUrl = imageUrl;
      const res = await client.networks.update(local.id, body);
      const n = (res && res.network) || res || {};
      const merged = {
        ...local,
        name: n.title || title.trim(),
        blurb: n.prompt != null ? n.prompt : (prompt.trim() || ""),
        photo: window.IndexApp.avatarUrl(n.imageUrl) || (removePhoto ? null : photo),
      };
      setLocal(merged);
      setTitle(merged.name);
      setPrompt(merged.blurb || "");
      setPhoto(merged.photo);
      setPhotoDirty(false);
      setRemovePhoto(false);
      if (onUpdated) onUpdated(merged);
    } catch (e) { /* keep draft */ }
    finally { setBusy(false); }
  };

  const deleteNetwork = async () => {
    if (!client || deleteText !== local.name || busy) return;
    setBusy(true);
    try {
      await client.networks.delete(local.id);
      if (onDeleted) onDeleted(local);
      else onBack();
    } catch (e) { setBusy(false); }
  };

  const tabStyle = (id) => ({
    padding:"8px 14px", border:"none", cursor:"pointer",
    borderBottom: tab === id ? "2px solid #000" : "2px solid transparent",
    background:"transparent",
    fontFamily:"var(--mac-mono)", fontSize:13,
    fontWeight: tab === id ? 700 : 400,
    color: tab === id ? "#000" : "var(--ink-2)",
    textTransform:"capitalize",
  });

  return (
    <div style={{
      position:"absolute", inset:0,
      display:"grid", placeItems:"center",
      gridTemplateColumns:"minmax(0, 1fr)",
      padding:"56px 40px", overflow:"auto",
    }}>
      <div style={{
        width:860, maxWidth:"100%",
        height:"min(660px, calc(100vh - 112px))",
      }}>
        <MacWindow
          title={`index · ${local.name.toLowerCase()}`}
          onClose={onBack}
          style={{ height:"100%", minHeight:0 }}>

          <div style={{ padding:"14px 24px 0", borderBottom:"2px solid #000" }}>
            <button
              onClick={onBack}
              style={{
                padding:0, border:"none", background:"transparent", cursor:"pointer",
                fontFamily:"var(--mac-mono)", fontSize:12, color:"var(--ink-2)",
              }}>← back</button>

            <div style={{
              marginTop:12, marginBottom:14,
              display:"flex", alignItems:"center", gap:14,
            }}>
              <NetworkTile name={local.name} size={48} photo={local.photo}/>
              <div style={{ flex:1, minWidth:0 }}>
                <div style={{
                  fontFamily:"var(--mac-mono)", fontSize:19, fontWeight:700, color:"#000",
                }}>{local.name}</div>
                <div style={{
                  marginTop:5, display:"flex", flexWrap:"wrap", gap:"4px 16px",
                }}>
                  {local.privacy && <MetaBit glyph="🔒">{local.privacy}</MetaBit>}
                  <MetaBit glyph="👤">{local.members} members</MetaBit>
                  {isOwner && <MetaBit glyph="★">owner</MetaBit>}
                </div>
              </div>

              {!isOwner && (
                <button
                  onClick={() => onLeave && onLeave(local)}
                  style={{
                    flex:"0 0 auto", cursor:"pointer",
                    fontFamily:"var(--mac-mono)", fontSize:13, padding:"7px 15px",
                    border:"1px solid var(--ink-warn)", background:"#fff", color:"var(--ink-warn)",
                    boxShadow:"1px 1px 0 rgba(138,0,0,0.3)",
                  }}>leave</button>
              )}
            </div>

            {isOwner && (
              <div style={{ display:"flex", gap:2 }}>
                <button type="button" style={tabStyle("overview")} onClick={() => setTab("overview")}>overview</button>
                <button type="button" style={tabStyle("settings")} onClick={() => setTab("settings")}>settings</button>
                <button type="button" style={tabStyle("access")} onClick={() => setTab("access")}>access</button>
              </div>
            )}
          </div>

          <div className="mac-scroll" style={{
            flex:"1 1 auto", minHeight:0, overflowY:"auto",
            padding:"14px 24px 20px",
          }}>
            {isOwner && tab === "settings" ? (
              <div style={{ display:"grid", gap:16 }}>
                <div style={{ display:"flex", alignItems:"center", gap:13 }}>
                  <NetworkPhoto
                    name={title || local.name}
                    photo={removePhoto ? null : photo}
                    onPick={(p) => { setPhoto(p); setPhotoDirty(true); setRemovePhoto(false); }}
                    size={72}
                  />
                  {photo && !removePhoto && (
                    <button
                      type="button"
                      onClick={() => { setRemovePhoto(true); setPhotoDirty(true); }}
                      style={{
                        border:"none", background:"transparent", cursor:"pointer",
                        fontFamily:"var(--mac-mono)", fontSize:12, color:"var(--ink-warn)",
                      }}>Remove image</button>
                  )}
                </div>
                <TextField label="title" required value={title} onChange={setTitle} placeholder="Network title"/>
                <div>
                  <FieldLabel>prompt</FieldLabel>
                  <div style={{ ...wellStyle(false), alignItems:"stretch" }}>
                    <textarea
                      value={prompt}
                      onChange={e => setPrompt(e.target.value)}
                      placeholder="What people can share in this network…"
                      rows={4}
                      style={{ ...inputReset(false), resize:"vertical", lineHeight:1.5 }}
                    />
                  </div>
                </div>
                <div style={{ display:"flex", justifyContent:"flex-end", gap:8 }}>
                  <button
                    type="button"
                    disabled={!settingsDirty || busy}
                    onClick={() => {
                      setTitle(local.name || "");
                      setPrompt(local.blurb || "");
                      setPhoto(local.photo || null);
                      setPhotoDirty(false);
                      setRemovePhoto(false);
                    }}
                    style={{
                      fontFamily:"var(--mac-mono)", fontSize:13, padding:"7px 15px",
                      border:"1px solid #000", background:"#fff", cursor:"pointer",
                    }}>Cancel</button>
                  <button
                    type="button"
                    disabled={!settingsDirty || !title.trim() || busy}
                    onClick={saveSettings}
                    style={{
                      fontFamily:"var(--mac-mono)", fontSize:13, padding:"7px 15px",
                      border:"1px solid #000", background:"#000", color:"#fff", cursor:"pointer",
                    }}>{busy ? "Saving…" : "Save"}</button>
                </div>
                <div style={{ borderTop:"1px solid #ddd", paddingTop:14 }}>
                  <button
                    type="button"
                    onClick={() => setShowDelete(s => !s)}
                    aria-expanded={showDelete}
                    style={{
                      display:"inline-flex", alignItems:"center", gap:6,
                      border:"none", background:"transparent", cursor:"pointer",
                      fontFamily:"var(--mac-mono)", fontSize:12, color:"var(--ink-warn)",
                    }}>
                    <span aria-hidden="true" style={{ fontSize:10, lineHeight:1 }}>
                      {showDelete ? "▲" : "▼"}
                    </span>
                    Danger Zone
                  </button>
                  {showDelete && (
                    <div style={{
                      marginTop:10, padding:12, border:"1px solid var(--ink-warn)", background:"#FFF5F5",
                      display:"grid", gap:10,
                    }}>
                      <p style={{ margin:0, fontFamily:"var(--mac-sans)", fontSize:13, color:"#8A0000" }}>
                        Delete this network. Type the name to confirm.
                      </p>
                      <input
                        value={deleteText}
                        onChange={e => setDeleteText(e.target.value)}
                        placeholder={local.name}
                        style={{
                          padding:"8px 10px", border:"1px solid #000",
                          fontFamily:"var(--mac-mono)", fontSize:12,
                        }}
                      />
                      <button
                        type="button"
                        disabled={deleteText !== local.name || busy}
                        onClick={deleteNetwork}
                        style={{
                          justifySelf:"end",
                          fontFamily:"var(--mac-mono)", fontSize:12, padding:"7px 14px",
                          border:"1px solid var(--ink-warn)", background:"#8A0000", color:"#fff",
                          cursor:"pointer",
                        }}>Delete</button>
                    </div>
                  )}
                </div>
              </div>
            ) : isOwner && tab === "access" ? (
              <div style={{ display:"grid", gap:22 }}>
                {!local.hasMasterKey && (
                  <div>
                    <RuleLabel>Visibility</RuleLabel>
                    <div style={{
                      marginTop:12, display:"grid",
                      gridTemplateColumns:"minmax(0, 1fr) minmax(0, 1fr)", gap:10,
                    }}>
                      <ChoiceCard
                        title="Public"
                        sub="Anyone can join"
                        selected={isPublic}
                        onClick={() => setJoinPolicy(true)}
                      />
                      <ChoiceCard
                        title="Private"
                        sub="Invite only"
                        selected={!isPublic}
                        onClick={() => setJoinPolicy(false)}
                      />
                    </div>
                  </div>
                )}

                {!local.hasMasterKey && (
                  <div>
                    <RuleLabel>{isPublic ? "Network Link" : "Invitation Link"}</RuleLabel>
                    <div style={{
                      marginTop:12, display:"flex", alignItems:"center", gap:8,
                      padding:"10px 12px",
                      border:"1px solid #000", background:"#F2F0EC",
                    }}>
                      <code style={{
                        flex:1, minWidth:0,
                        fontFamily:"var(--mac-mono)", fontSize:12, color:"var(--ink-2)",
                        overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap",
                      }}>{shareUrl || "No invitation link yet."}</code>
                      {shareUrl && (
                        <button
                          type="button"
                          onClick={copyLink}
                          title={copied ? "Copied" : "Copy link"}
                          style={{
                            flex:"0 0 auto", cursor:"pointer",
                            padding:"4px 10px", border:"1px solid #000",
                            background: copied ? "#000" : "#fff",
                            color: copied ? "#fff" : "#000",
                            fontFamily:"var(--mac-mono)", fontSize:11,
                            boxShadow:"1px 1px 0 rgba(0,0,0,0.2)",
                          }}>{copied ? "copied" : "copy"}</button>
                      )}
                    </div>
                  </div>
                )}

                <NetworkMembers
                  networkId={local.id}
                  meId={meId}
                  members={members}
                  setMembers={setMembers}
                  busy={busy}
                  setBusy={setBusy}
                />
              </div>
            ) : (
              <>
                <div style={{
                  display:"flex", alignItems:"baseline", justifyContent:"space-between",
                  gap:12, marginBottom:12,
                }}>
                  <RuleLabel>Your Signals</RuleLabel>
                  <span style={{
                    flex:"0 0 auto",
                    fontFamily:"var(--mac-mono)", fontSize:12, color:"var(--ink-2)",
                  }}>{signalsLoading ? "…" : `${signals.length} signal${signals.length === 1 ? "" : "s"}`}</span>
                </div>

                {undo && (
                  <div className="fade-up" style={{
                    marginBottom:10, padding:"8px 12px",
                    border:"1px solid #000", background:"#F2F0EC",
                    display:"flex", alignItems:"center", justifyContent:"space-between", gap:12,
                  }}>
                    <span style={{
                      fontFamily:"var(--mac-sans)", fontSize:12, color:"#000",
                    }}>
                      removed from {local.name}. the signal is still running everywhere else.
                    </span>
                    <button
                      onClick={putBack}
                      style={{
                        flex:"0 0 auto", cursor:"pointer",
                        padding:"4px 11px", border:"1px solid #000", background:"#fff",
                        fontFamily:"var(--mac-mono)", fontSize:11, color:"#000",
                        boxShadow:"1px 1px 0 rgba(0,0,0,0.2)",
                      }}>put it back</button>
                  </div>
                )}

                <div style={{ display:"grid", gap:10 }}>
                  {signals.map(s => (
                    <Signal
                      key={s.id}
                      sig={s}
                      netName={local.name}
                      onRemove={remove}
                      onOpen={onOpenSignal ? () => onOpenSignal(s) : undefined}
                    />
                  ))}
                </div>

                {!signalsLoading && !signals.length && (
                  <p style={{
                    fontFamily:"var(--mac-sans)", fontSize:13, color:"var(--ink-2)",
                  }}>You haven&apos;t shared any signals in this network yet</p>
                )}
              </>
            )}
          </div>
        </MacWindow>
      </div>
    </div>
  );
}

function Networks({ onClose, onOpenSignal }) {
  // Live-only: the mirror holds the signed-in user's networks (set by
  // applyLoaded). Ensure it is an array so the local unshift below still
  // persists a just-created network to the other screens.
  const NETWORKS = (window.INDEX_DATA.NETWORKS = window.INDEX_DATA.NETWORKS || []);
  // Live backend wiring: writes fire against services/api when signed in, but
  // the UI keeps updating the local mirror exactly as the offline demo does.
  const live = !!(window.IndexApp && window.IndexApp.isAuthed());
  const client = live ? window.IndexApp.getClient() : null;
  const [tab, setTab] = useState("mine");
  const [openNet, setOpenNet] = useState(null);
  const [creating, setCreating] = useState(false);
  // Early-access request flow: non-staff submit a reviewed request instead of
  // creating a live network. `canReview` (from the server) gates direct create.
  const [requesting, setRequesting] = useState(false);
  const [editingRequest, setEditingRequest] = useState(null);
  const [myRequests, setMyRequests] = useState([]);
  const [canReview, setCanReview] = useState(false);
  // Local mirror of the shared list so a new network renders immediately;
  // NETWORKS itself is still mutated so other screens see it too.
  const [nets, setNets] = useState(NETWORKS);

  const loadRequests = () => {
    if (!client) return;
    client.networkRequests.listMine()
      .then((r) => {
        setMyRequests((r && r.requests) || []);
        setCanReview(!!(r && r.canReview));
      })
      .catch(() => {});
  };

  // One-shot on mount: `client` is rebuilt each render, so depending on it would
  // loop; a single load (refreshed explicitly after mutations) is enough.
  useEffect(() => { loadRequests(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // You made it, so you're in it and you run it. Picture is optional: a data
  // URL from the picker is uploaded first so imageUrl on the server is a real
  // storage key, not a discarded local preview. After create (or when a reviewed
  // request is approved and the network lands in the list), owners open Access
  // to copy the invitation / network link — same as the web Access tab.
  const createNetwork = async ({ name, desc, access, photo }) => {
    let imageUrl = null;
    let photoOut = photo || undefined;
    if (client && photo && /^data:/i.test(photo)) {
      try {
        imageUrl = await client.storage.uploadIndexImage(photo);
        photoOut = window.IndexApp.avatarUrl(imageUrl) || imageUrl;
      } catch (e) { /* keep the local data URL in the mirror */ }
    }
    const joinPolicy = access === "public" ? "anyone" : "invite_only";
    let created = {
      id: `net-${Date.now().toString(36)}`,
      name,
      blurb: desc || undefined,
      photo: photoOut,
      members: 1,
      privacy: access,
      joinPolicy,
      invitationCode: null,
      role: "owner",
      joined: true,
      isPersonal: false,
      hasMasterKey: false,
      signals: [],
    };
    if (client) {
      try {
        const res = await client.networks.create({
          title: name,
          prompt: desc || undefined,
          imageUrl: imageUrl || undefined,
          joinPolicy,
        });
        const n = (res && res.network) || res || {};
        const perms = n.permissions || {};
        const jp = perms.joinPolicy || joinPolicy;
        const code = perms.invitationLink && perms.invitationLink.code;
        created = {
          ...created,
          id: n.id || created.id,
          name: n.title || created.name,
          members: (n._count && n._count.members) || n.memberCount || 1,
          joinPolicy: jp,
          privacy: jp === "anyone" ? "public" : "private",
          invitationCode: code || null,
          hasMasterKey: n.hasMasterKey === true,
          photo: window.IndexApp.avatarUrl(n.imageUrl) || created.photo,
          source: n,
        };
      } catch (e) { /* keep the optimistic mirror */ }
    }
    NETWORKS.unshift(created);
    setNets([...NETWORKS]);
    setCreating(false);
    setTab("mine");
    setOpenNet(created);
  };

  const updateOpenNet = (merged) => {
    setNets(prev => prev.map(n => n.id === merged.id ? { ...n, ...merged } : n));
    const i = NETWORKS.findIndex(n => n.id === merged.id);
    if (i >= 0) NETWORKS[i] = { ...NETWORKS[i], ...merged };
  };

  // Submit (or resubmit) a network request; resolves the request so the form
  // can show its confirmation panel. Same upload path as create: a picked
  // picture becomes a storage key before the request is written.
  const submitRequest = async (input) => {
    if (!client) return null;
    let imageUrl = input.imageUrl;
    if (input.photo && /^data:/i.test(input.photo)) {
      try {
        imageUrl = await client.storage.uploadIndexImage(input.photo);
      } catch (e) { /* request still goes through without a picture */ }
    }
    const body = {
      name: input.name,
      purpose: input.purpose,
      expectedSize: input.expectedSize,
      joinPolicy: input.joinPolicy,
      ...(imageUrl !== undefined ? { imageUrl } : {}),
    };
    const p = editingRequest
      ? client.networkRequests.update(editingRequest.id, body)
      : client.networkRequests.create(body);
    return p.then((res) => {
      loadRequests();
      return (res && res.request) || res;
    });
  };

  const dismissRequest = (id) => {
    setMyRequests(prev => prev.filter(r => r.id !== id));
    if (client) client.networkRequests.dismiss(id).catch(() => {});
  };

  const startCreate = () => {
    // Staff create networks directly; everyone else submits a reviewed request.
    if (canReview) {
      setCreating(true);
    } else {
      setEditingRequest(null);
      setRequesting(true);
    }
  };

  const joinNetwork = (net) => {
    setNets(prev => prev.map(n => n.id === net.id ? { ...n, joined: true, role: "member" } : n));
    if (client) client.networks.join(net.id).catch(() => {});
  };

  const leaveNetwork = (net) => {
    setNets(prev => prev.filter(n => n.id !== net.id));
    const i = NETWORKS.findIndex(n => n.id === net.id);
    if (i >= 0) NETWORKS.splice(i, 1);
    if (client) client.networks.leave(net.id).catch(() => {});
    setOpenNet(null);
  };

  const deleteNetwork = (net) => {
    setNets(prev => prev.filter(n => n.id !== net.id));
    const i = NETWORKS.findIndex(n => n.id === net.id);
    if (i >= 0) NETWORKS.splice(i, 1);
    setOpenNet(null);
  };

  if (openNet) {
    return (
      <NetworkDetail
        net={openNet}
        onBack={() => setOpenNet(null)}
        onLeave={leaveNetwork}
        onUpdated={updateOpenNet}
        onDeleted={deleteNetwork}
        onOpenSignal={onOpenSignal}
      />
    );
  }
  // Its own window, like the profile screen, not an overlay on this one.
  if (creating) {
    return <CreateNetwork onCancel={() => setCreating(false)} onCreate={createNetwork}/>;
  }
  if (requesting) {
    return (
      <RequestNetwork
        initial={editingRequest}
        onCancel={() => { setRequesting(false); setEditingRequest(null); }}
        onSubmit={submitRequest}
      />
    );
  }

  const mine = nets.filter(n => n.joined);
  const rest = nets.filter(n => !n.joined);
  const shown = tab === "mine" ? mine : rest;

  return (
    <div style={{
      position:"absolute", inset:0,
      display:"grid", placeItems:"center",
      gridTemplateColumns:"minmax(0, 1fr)",
      padding:"56px 40px", overflow:"auto",
    }}>
      {/* fixed height so switching tabs doesn't resize the frame */}
      <div style={{
        width:860, maxWidth:"100%",
        height:"min(660px, calc(100vh - 112px))",
      }}>
        <MacWindow
          title="index · networks"
          onClose={onClose}
          style={{ height:"100%", minHeight:0 }}>

          <div style={{
            padding:"18px 24px 0", borderBottom:"2px solid #000",
          }}>
            <div style={{
              display:"flex", alignItems:"center", justifyContent:"space-between", gap:12,
            }}>
              <h2 style={{
                margin:0,
                fontFamily:"var(--mac-mono)", fontSize:19, fontWeight:700, color:"#000",
              }}>networks</h2>
              <ActionButton
                title={canReview ? "start a new network" : "request a new network"}
                onClick={startCreate}>+ create</ActionButton>
            </div>

            <div style={{ padding:"14px 0" }}>
              <MacSegmented
                size="lg"
                value={tab}
                onChange={setTab}
                options={[
                  { value:"mine",     label:`my networks (${mine.length})` },
                  { value:"discover", label:"discover" },
                ]}
              />
            </div>
          </div>

          <div className="mac-scroll" style={{
            flex:"1 1 auto", minHeight:0, overflowY:"auto",
            padding:"6px 12px 14px",
          }}>
            {tab === "mine" && myRequests.map(req => (
              <RequestStatusRow
                key={req.id}
                req={req}
                onEdit={(r) => { setEditingRequest(r); setRequesting(true); }}
                onDismiss={dismissRequest}
              />
            ))}

            {shown.map(net => <NetworkRow key={net.id} net={net} onOpen={setOpenNet} onJoin={joinNetwork}/>)}

            {!shown.length && !(tab === "mine" && myRequests.length) && (
              <p style={{
                margin:"18px 12px",
                fontFamily:"var(--mac-sans)", fontSize:13, color:"var(--ink-2)",
              }}>nothing here yet.</p>
            )}
          </div>
        </MacWindow>
      </div>

    </div>
  );
}
