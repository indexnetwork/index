// Create-network sheet. Fields mirror the product spec: name, optional
// description, type, access. "Experiment" (headless API signup) is
// deliberately not offered here, existing networks may still carry it as a
// privacy value, but it isn't something you pick by hand.
function CreateNetwork({ onCancel, onCreate }) {
  const [name, setName]     = useState("");
  const [desc, setDesc]     = useState("");
  const [photo, setPhoto]   = useState(null);
  const [access, setAccess] = useState("private");
  const [busy, setBusy]     = useState(false);
  const [err, setErr]       = useState("");

  const named = name.trim();
  const canCreate = named.length > 0 && !busy;

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

  // Held open until the server answers. A create that fails has to say so here
  // rather than handing the next screen an optimistic network that doesn't
  // exist, which is the one way "created" could be a lie.
  const submit = async () => {
    if (!canCreate) return;
    setBusy(true);
    setErr("");
    try {
      await onCreate({ name: named, desc: desc.trim(), access, photo });
    } catch (e) {
      setErr((e && e.message) || "couldn't create the network. try again.");
      setBusy(false);
    }
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
          title="new network"
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
            }}>a network is a group that shares signals. if you run a community,
              event, or team, create one here, then invite your members so their
              signals can find each other.</div>
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
            {/* the failure sits next to the button that caused it */}
            {err && (
              <span style={{
                flex:1, minWidth:0,
                fontFamily:"var(--mac-sans)", fontSize:12, color:"var(--ink-warn)",
              }}>{err}</span>
            )}
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
              title={canCreate ? undefined : (busy ? "creating…" : "give the network a name first")}
              style={{
                fontFamily:"var(--mac-mono)", fontSize:13, padding:"7px 19px",
                border:"1px solid #000",
                background: canCreate ? "#000" : "#EDEAE1",
                color: canCreate ? "#fff" : "var(--ink-3)",
                boxShadow:"1px 1px 0 rgba(0,0,0,0.2)",
                cursor: canCreate ? "pointer" : "default",
                fontWeight:700,
              }}>{busy ? "creating…" : "create"}</button>
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
          title="request a network"
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
                  <b style={{ color:"#000" }}>{(done && done.title) || named}</b> is in review.
                  you&apos;ll hear back shortly.
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
                }}>
                  {/* what it is, then the caveat, on their own lines: one
                      four-line paragraph in a banner is a wall */}
                  <p style={{ margin:0 }}>a network is a group that shares
                    signals. if you run a community, event, or team, request one
                    here and invite your members so their signals can find each
                    other.</p>
                  <p style={{ margin:"7px 0 0" }}>network creation is still
                    early, so this gets reviewed before it goes live.</p>
                </div>
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
      <NetworkTile id={req.id} name={req.title} photo={
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
            }}>your request is in review.</div>}
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

function NetworkRow({ net, onOpen, onJoin, joining }) {
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
      <NetworkTile id={net.id} name={net.name} photo={net.photo}/>

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
        : <ActionButton disabled={joining} onClick={() => onJoin && onJoin(net)} title="ask to join">{joining ? "joining…" : "join"}</ActionButton>}
    </div>
  );
}

