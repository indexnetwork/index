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
  return (
    <Avatar
      id={member.id}
      name={member.name}
      photo={member.avatar}
      size={size}
      blur={!!member.isGhost}
    />
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
  if (net.invitationCode) return `${base}/l/${encodeURIComponent(net.invitationCode)}`;
  return null;
}

function networkIsOwner(net) {
  if (!net || net.isPersonal) return false;
  const role = net.role || (net.source && net.source.role);
  return role === "owner" || role === "admin";
}

// `initialTab` is the tab the window opens on. The list opens a network on its
// overview; creation opens it on access, where the invitation link is, with
// `flash` set to the line confirming the network now exists.
function NetworkDetail({ net, initialTab, flash, onBack, onLeave, onUpdated, onDeleted, onOpenSignal }) {
  const [local, setLocal] = useState(net);
  const [signals, setSignals] = useState(net.signals || []);
  const [signalsLoading, setSignalsLoading] = useState(false);
  const [undo, setUndo] = useState(null);
  const isOwner = networkIsOwner(local);
  const [tab, setTab] = useState(initialTab || "overview");
  // Arrival note: it says the create went through and holds until dismissed,
  // rather than timing out while you're still reading the link below it.
  const [note, setNote] = useState(flash || "");
  const [copied, setCopied] = useState(false);
  const [showRegenerateConfirm, setShowRegenerateConfirm] = useState(false);
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

  const regenerateLink = async () => {
    if (!client || !local.id || busy) return;
    setBusy(true);
    try {
      const res = await client.networks.regenerateInvitationLink(local.id);
      const n = (res && res.network) || res || {};
      const perms = n.permissions || {};
      const code = (perms.invitationLink && perms.invitationLink.code) || null;
      const merged = { ...local, invitationCode: code };
      setLocal(merged);
      if (onUpdated) onUpdated(merged);
      setShowRegenerateConfirm(false);
    } catch (e) { /* leave idle */ }
    finally { setBusy(false); }
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
          title={local.name.toLowerCase()}
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
              <NetworkTile id={local.id} name={local.name} size={48} photo={local.photo}/>
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
            {/* accent fill, not the quiet grey of the undo strip: this is the
                only thing telling you the network exists, so it holds the eye
                and stays until you dismiss it */}
            {note && (
              <div className="fade-up" style={{
                marginBottom:16, padding:"10px 12px",
                border:"2px solid #000", background:"#FF8A00",
                boxShadow:"2px 2px 0 rgba(0,0,0,0.25)",
                display:"flex", alignItems:"center", justifyContent:"space-between", gap:12,
              }}>
                <span style={{
                  fontFamily:"var(--mac-sans)", fontSize:13, fontWeight:600, color:"#000",
                }}>{note}</span>
                <button
                  onClick={() => setNote("")}
                  title="dismiss"
                  aria-label="dismiss"
                  style={{
                    flex:"0 0 auto", cursor:"pointer",
                    padding:"2px 8px", border:"1px solid #000", background:"#fff",
                    fontFamily:"var(--mac-mono)", fontSize:11, color:"#000",
                    boxShadow:"1px 1px 0 rgba(0,0,0,0.2)",
                  }}>✕</button>
              </div>
            )}

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
                    <RuleLabel>Invitation link</RuleLabel>
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
                        <>
                          <button
                            type="button"
                            onClick={() => setShowRegenerateConfirm((v) => !v)}
                            disabled={busy}
                            title="Regenerate invitation link"
                            aria-label="Regenerate invitation link"
                            style={{
                              flex:"0 0 auto", cursor: busy ? "default" : "pointer",
                              padding:"4px 10px", border:"1px solid #000",
                              background: showRegenerateConfirm ? "#000" : "#fff",
                              color: showRegenerateConfirm ? "#fff" : "#000",
                              fontFamily:"var(--mac-mono)", fontSize:11,
                              boxShadow:"1px 1px 0 rgba(0,0,0,0.2)",
                              opacity: busy ? 0.5 : 1,
                            }}>↻</button>
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
                        </>
                      )}
                    </div>
                    {showRegenerateConfirm && shareUrl && (
                      <div style={{
                        marginTop:8, padding:12,
                        border:"1px solid #000", background:"#FFF5F5",
                        display:"grid", gap:10,
                      }}>
                        <p style={{ margin:0, fontFamily:"var(--mac-sans)", fontSize:13, color:"#8A0000" }}>
                          The current link stops working immediately. Regenerate?
                        </p>
                        <div style={{ display:"flex", justifyContent:"flex-end", gap:8 }}>
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => setShowRegenerateConfirm(false)}
                            style={{
                              fontFamily:"var(--mac-mono)", fontSize:12, padding:"7px 14px",
                              border:"1px solid #000", background:"#fff", color:"#000", cursor:"pointer",
                            }}>Cancel</button>
                          <button
                            type="button"
                            disabled={busy}
                            onClick={regenerateLink}
                            style={{
                              fontFamily:"var(--mac-mono)", fontSize:12, padding:"7px 14px",
                              border:"1px solid #000", background:"#000", color:"#fff", cursor:"pointer",
                            }}>{busy ? "Regenerating…" : "Regenerate"}</button>
                        </div>
                      </div>
                    )}
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
