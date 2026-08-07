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

            {/* live preview, the tile is derived from the name, so it only
                becomes meaningful once something is typed */}
            <div style={{ display:"flex", alignItems:"center", gap:13, marginBottom:20 }}>
              <NetworkPhoto name={named} photo={photo} onPick={setPhoto} size={42}/>
              <span style={{
                fontFamily:"var(--mac-mono)", fontSize:17, fontWeight:600,
                color: named ? "#000" : "var(--ink-4)",
                minWidth:0, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap",
              }}>{named || "network name"}</span>
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

// Early-access "request a network" screen. Same frame as CreateNetwork, but it
// submits to /network-requests (reviewed) instead of creating a live network,
// and ends on a confirmation panel. Also handles resubmitting a "needs changes"
// request when `initial` is passed.
function RequestNetwork({ initial, onCancel, onSubmit }) {
  const [name, setName]       = useState((initial && initial.title) || "");
  const [purpose, setPurpose] = useState((initial && initial.purpose) || "");
  const [size, setSize]       = useState((initial && initial.expectedSize) || "");
  const [notes, setNotes]     = useState((initial && initial.notes) || "");
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
      purpose: purpose.trim() || undefined,
      expectedSize: size || undefined,
      notes: notes.trim() || undefined,
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
        height:"min(660px, calc(100vh - 112px))",
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
                }}>network creation is still early. tell us what you&apos;re hoping to build and we&apos;ll get back to you.</div>
              </div>

              <div className="mac-scroll" style={{
                flex:"1 1 auto", minHeight:0, overflowY:"auto",
                padding:"20px 24px 22px",
              }}>
                <div style={{ display:"grid", gridTemplateColumns:"minmax(0, 1fr) minmax(0, 1fr)", gap:"14px 18px" }}>
                  <TextField
                    label="network name" required
                    value={name}
                    onChange={setName}
                    placeholder="e.g. Edge City"
                  />
                </div>

                <div style={{ marginTop:14 }}>
                  <FieldLabel>what are you hoping to build?</FieldLabel>
                  <div style={{ ...wellStyle(false), alignItems:"stretch" }}>
                    <textarea
                      value={purpose}
                      onChange={e => setPurpose(e.target.value)}
                      placeholder="who is it for, who do you expect to join, and what should people or agents be able to discover through it?"
                      rows={3}
                      style={{ ...inputReset(false), resize:"vertical", lineHeight:1.5 }}
                    />
                  </div>
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

                <div style={{ marginTop:14 }}>
                  <FieldLabel right={
                    <span style={{
                      fontFamily:"var(--mac-mono)", fontSize:10, color:"var(--ink-3)",
                    }}>optional</span>
                  }>anything else we should know?</FieldLabel>
                  <div style={{ ...wellStyle(false), alignItems:"stretch" }}>
                    <textarea
                      value={notes}
                      onChange={e => setNotes(e.target.value)}
                      placeholder="links, timing, context, or what you'd like to experiment with."
                      rows={2}
                      style={{ ...inputReset(false), resize:"vertical", lineHeight:1.5 }}
                    />
                  </div>
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
                  }}>{sending ? "sending…" : isEdit ? "resubmit" : "create network"}</button>
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
      <NetworkTile name={req.title}/>
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

function Signal({ sig, netName, onRemove }) {
  const [hover, setHover] = useState(false);
  return (
    <div
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        border:"1px solid #000", background:"#fff",
        boxShadow: hover ? "3px 3px 0 rgba(0,0,0,0.22)" : "2px 2px 0 rgba(0,0,0,0.22)",
        padding:"12px 14px",
        display:"flex", alignItems:"flex-start", gap:14,
      }}>
      <div style={{ flex:1, minWidth:0, display:"grid", gap:9 }}>
        <div style={{
          fontFamily:"var(--mac-sans)", fontSize:13, lineHeight:1.5, color:"#000",
        }}>{sig.text}</div>
        <MetaBit glyph="▤">{sig.date}</MetaBit>
      </div>

      {/* Same gadget as pause/stop in the conversation pane. Removes it from
          this network only, the signal keeps running everywhere else. */}
      <span
        title={`stop sharing this signal with ${netName}. it keeps running elsewhere`}
        style={{ flex:"0 0 auto" }}>
        <SignalAction label="− remove" onClick={() => onRemove && onRemove(sig)}/>
      </span>
    </div>
  );
}

function NetworkDetail({ net, onBack, onLeave }) {
  const [signals, setSignals] = useState(net.signals || []);
  // Last removal, kept so it can be put back, removing is reversible by
  // definition here, so the undo is the affordance that says "not deleted".
  const [undo, setUndo] = useState(null);

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
          title={`index · ${net.name.toLowerCase()}`}
          onClose={onBack}
          style={{ height:"100%", minHeight:0 }}>

          <div style={{ padding:"14px 24px 16px", borderBottom:"2px solid #000" }}>
            <button
              onClick={onBack}
              style={{
                padding:0, border:"none", background:"transparent", cursor:"pointer",
                fontFamily:"var(--mac-mono)", fontSize:12, color:"var(--ink-2)",
              }}>← back</button>

            <div style={{
              marginTop:12,
              display:"flex", alignItems:"center", gap:14,
            }}>
              <NetworkTile name={net.name} size={48} photo={net.photo}/>
              <div style={{ flex:1, minWidth:0 }}>
                <div style={{
                  fontFamily:"var(--mac-mono)", fontSize:19, fontWeight:700, color:"#000",
                }}>{net.name}</div>
                <div style={{
                  marginTop:5, display:"flex", flexWrap:"wrap", gap:"4px 16px",
                }}>
                  {net.privacy && <MetaBit glyph="🔒">{net.privacy}</MetaBit>}
                  <MetaBit glyph="👤">{net.members} members</MetaBit>
                </div>
              </div>

              {/* leaving is destructive, so it carries the red, but stays outline
                  only, since it isn't the thing you came here to do */}
              <button
                onClick={() => onLeave && onLeave(net)}
                style={{
                  flex:"0 0 auto", cursor:"pointer",
                  fontFamily:"var(--mac-mono)", fontSize:13, padding:"7px 15px",
                  border:"1px solid var(--ink-warn)", background:"#fff", color:"var(--ink-warn)",
                  boxShadow:"1px 1px 0 rgba(138,0,0,0.3)",
                }}>leave</button>
            </div>
          </div>

          <div className="mac-scroll" style={{
            flex:"1 1 auto", minHeight:0, overflowY:"auto",
            padding:"14px 24px 20px",
          }}>
            <div style={{
              display:"flex", alignItems:"baseline", justifyContent:"space-between",
              gap:12, marginBottom:12,
            }}>
              <RuleLabel>my signals</RuleLabel>
              <span style={{
                flex:"0 0 auto",
                fontFamily:"var(--mac-mono)", fontSize:12, color:"var(--ink-2)",
              }}>{signals.length} signals</span>
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
                  removed from {net.name}. the signal is still running everywhere else.
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
                <Signal key={s.id} sig={s} netName={net.name} onRemove={remove}/>
              ))}
            </div>

            {!signals.length && (
              <p style={{
                fontFamily:"var(--mac-sans)", fontSize:13, color:"var(--ink-2)",
              }}>you haven't published anything into this network yet.</p>
            )}
          </div>
        </MacWindow>
      </div>
    </div>
  );
}

function Networks({ onClose }) {
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

  // You made it, so you're in it and you run it.
  const createNetwork = ({ name, desc, access, photo }) => {
    NETWORKS.unshift({
      id: `net-${Date.now().toString(36)}`,
      name,
      blurb: desc || undefined,
      photo: photo || undefined,
      members: 1,
      privacy: access,
      role: "admin",
      joined: true,
      signals: [],
    });
    setNets([...NETWORKS]);
    setCreating(false);
    setTab("mine");
    if (client) {
      client.networks.create({
        title: name,
        prompt: desc || undefined,
        joinPolicy: access === "public" ? "anyone" : "invite_only",
      }).catch(() => {});
    }
  };

  // Submit (or resubmit) a network request; resolves the request so the form
  // can show its confirmation panel.
  const submitRequest = (input) => {
    if (!client) return Promise.resolve(null);
    const p = editingRequest
      ? client.networkRequests.update(editingRequest.id, input)
      : client.networkRequests.create(input);
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
    setNets(prev => prev.map(n => n.id === net.id ? { ...n, joined: false, role: undefined } : n));
    if (client) client.networks.leave(net.id).catch(() => {});
    setOpenNet(null);
  };

  if (openNet) {
    return <NetworkDetail net={openNet} onBack={() => setOpenNet(null)} onLeave={leaveNetwork}/>;
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
