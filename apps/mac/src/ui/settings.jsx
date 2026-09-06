// Settings, reached from the account chip on the hub. Three panes: what the
// network sees (profile), how the agent interrupts you (notifications), and
// the keys other agents authenticate with.

// Soft length guide for the introduction counter. The API stores intro with no
// hard cap, and enrichment synthesizes a full narrative paragraph, so this is
// generous enough that a real enriched profile doesn't render as "over".
const INTRO_MAX = 2000;

/* ---------- shared field chrome ---------- */

function FieldLabel({ children, required, right }) {
  return (
    <div style={{
      display:"flex", alignItems:"baseline", justifyContent:"space-between",
      gap:10, marginBottom:5,
    }}>
      <span style={{
        fontFamily:"var(--mac-mono)", fontSize:11, fontWeight:600, color:"#000",
      }}>
        {children}
        {required && <span style={{ color:"#FF8A00", marginLeft:4 }}>*</span>}
      </span>
      {right}
    </div>
  );
}

// Sunken well, the inverse of a raised gadget, so inputs read as editable.
const wellStyle = (disabled) => ({
  border:"1px solid #000",
  background: disabled ? "#EDEAE1" : "#fff",
  boxShadow:"inset 1px 1px 0 var(--ink-3), inset -1px -1px 0 #FFF",
  padding:"7px 10px",
  display:"flex", alignItems:"center", gap:0,
});

const inputReset = (disabled) => ({
  flex:1, minWidth:0, background:"transparent", border:"none", outline:"none",
  fontFamily:"var(--mac-sans)", fontSize:13,
  color: disabled ? "var(--ink-2)" : "#000",
});

function TextField({ label, required, value, onChange, disabled, placeholder, right }) {
  return (
    <div style={{ minWidth:0 }}>
      <FieldLabel required={required} right={right}>{label}</FieldLabel>
      <div style={wellStyle(disabled)}>
        <input
          value={value}
          disabled={disabled}
          placeholder={placeholder}
          onChange={e => onChange && onChange(e.target.value)}
          style={inputReset(disabled)}
        />
      </div>
    </div>
  );
}

/* One social field: [mark][x.com/][username][×].

   The prefix is its own locked cell rather than a hint inside the input, so
   there is nothing to decide before typing. A placeholder reading
   "x.com/username" left the question open — write the whole thing, or just the
   name? — and the field is only ever the part that differs between people.

   The row belongs to its platform and stays put: × empties it rather than
   taking it away, because a row that can be deleted is a row the person cannot
   get back; there is no "add github" to undo it with. Only the extra websites,
   which they added themselves, can actually go.

   A whole URL pasted from a browser is still welcome: it is trimmed back to the
   handle on blur, and left alone while being typed so the field never fights
   the keyboard. */
function SocialField({ platform, value, onChange, onReset, onRemove }) {
  const [hot, setHot] = useState(false);
  const isWeb = platform === "website";
  // A website is a whole domain rather than a name under someone else's, so
  // only the scheme is fixed for it.
  const prefix = isWeb ? "https://" : (SOCIAL_PREFIX[platform] || "");
  const text = String(value || "");
  // Says so in place rather than saving quietly and leaving a dead link on the
  // profile: a bare word under "website" names no host anyone can reach.
  const unresolved = !!text.trim() && !buildSocialHref(platform, text);
  const clear = onRemove || onReset;
  const normalize = (raw) => {
    const parsed = parseSocial({ id: platform, handle: raw });
    // A URL for some other platform keeps its full text, since that is where
    // it goes and where it will be filed; only this row's own gets shortened.
    return parsed.platform === platform ? parsed.handle : raw.trim();
  };
  return (
    <div style={{
      display:"flex", background:"#fff",
      border:`1px solid ${unresolved ? "var(--ink-warn)" : "#000"}`,
    }}>
      <span
        title={platform}
        style={{
          background:"#EDEAE1", padding:"0 9px",
          display:"flex", alignItems:"center", flex:"0 0 auto",
        }}>
        <SocialGlyph id={platform} size={15} color={unresolved ? "var(--ink-warn)" : undefined}/>
      </span>
      {/* Locked, and undivided from the mark beside it: one grey shoulder that
          is plainly fixed, so the white part is plainly the only thing to fill. */}
      <span
        aria-hidden="true"
        style={{
          background:"#EDEAE1", padding:"0 8px 0 0",
          borderRight:`1px solid ${unresolved ? "var(--ink-warn)" : "#000"}`,
          display:"flex", alignItems:"center", flex:"0 0 auto",
          fontFamily:"var(--mac-mono)", fontSize:11, letterSpacing:0.2,
          color:"var(--ink-2)", whiteSpace:"nowrap", userSelect:"none",
        }}>{prefix}</span>
      <input
        value={text}
        placeholder={isWeb ? "your-site.com" : "username"}
        aria-label={isWeb ? "website domain" : `${platform} username`}
        title={unresolved
          ? `“${text.trim()}” is not an address yet — paste the full link, or just the ${isWeb ? "domain" : "username"}`
          : undefined}
        onChange={e => onChange && onChange(e.target.value)}
        onBlur={e => onChange && onChange(normalize(e.target.value))}
        style={{ ...inputReset(false), padding:"8px 10px" }}
      />
      {clear && !!text && (
        <button
          onClick={clear}
          onMouseEnter={() => setHot(true)}
          onMouseLeave={() => setHot(false)}
          title={onRemove ? `remove ${platform}` : `clear ${platform}`}
          aria-label={onRemove ? `remove ${platform}` : `clear ${platform}`}
          style={{
            flex:"0 0 auto", width:30, cursor:"pointer",
            borderLeft:"1px solid #000",
            background: hot ? "var(--ink-warn)" : "#EDEAE1",
            color: hot ? "#fff" : "var(--ink-2)",
            fontFamily:"var(--mac-mono)", fontSize:13, lineHeight:1,
          }}>×</button>
      )}
    </div>
  );
}

function SectionRule({ children, size }) {
  return <div style={{ marginTop:26 }}><RuleLabel size={size}>{children}</RuleLabel></div>;
}

/* ---------- pane 1 · profile ---------- */

// The picture is the control, see PicturePicker in primitives for the shared
// icon, interaction and file rules.
function PhotoPicker({ me, name, photo, onPick }) {
  const [err, setErr] = useState("");

  return (
    <div style={{ display:"flex", alignItems:"center", gap:14 }}>
      <PicturePicker size={54} label="change photo" onPick={onPick} onError={setErr}>
        {photo
          ? <img
              src={photo}
              alt=""
              style={{
                width:54, height:54, objectFit:"cover", display:"block",
              }}/>
          : <Avatar id={me.id} name={me.name} size={54}/>}
      </PicturePicker>

      <div style={{ minWidth:0 }}>
        <div style={{
          fontFamily:"var(--mac-mono)", fontSize:17, fontWeight:700, color:"#000",
        }}>{name || me.name}</div>

        {err && (
          <div style={{
            marginTop:4,
            fontFamily:"var(--mac-sans)", fontSize:11, color:"var(--ink-warn)",
          }}>{err}</div>
        )}
      </div>
    </div>
  );
}

function ProfilePane({ me, form, set, profileOnly = false }) {
  const over = form.intro.length > INTRO_MAX;

  return (
    <div>
      <PhotoPicker
        me={me}
        name={form.name}
        photo={form.photo}
        onPick={url => set("photo", url)}
      />

      <div style={{
        marginTop:22,
        display:"grid", gridTemplateColumns:"minmax(0, 1fr) minmax(0, 1fr)", gap:"14px 18px",
      }}>
        <TextField
          label="name" required
          value={form.name}
          onChange={v => set("name", v)}
        />
        {/* Identity is bound to the email the agent authenticated with. The
            greyed well and non-editable cursor already say it isn't editable,
            so the field carries no extra badge. */}
        <TextField
          label="email" disabled
          value={form.email}
        />
        {/* One column like name/email, a full-width field for "NYC, United
            States" was far more room than the value ever needs. */}
        <TextField
          label="location"
          value={form.location}
          onChange={v => set("location", v)}
        />
      </div>

      <div style={{ marginTop:14 }}>
        <FieldLabel right={
          <span style={{
            fontFamily:"var(--mac-mono)", fontSize:11,
            color: over ? "var(--ink-warn)" : "var(--ink-2)",
            fontWeight: over ? 700 : 400,
          }}>{form.intro.length}/{INTRO_MAX}</span>
        }>introduction</FieldLabel>
        <div style={{ ...wellStyle(false), alignItems:"stretch", padding:"8px 10px" }}>
          <textarea
            value={form.intro}
            onChange={e => set("intro", e.target.value)}
            rows={4}
            style={{ ...inputReset(false), resize:"vertical", lineHeight:1.5 }}
          />
        </div>
      </div>

      <SectionRule>socials</SectionRule>

      <div style={{
        marginTop:12,
        display:"grid", gridTemplateColumns:"minmax(0, 1fr) minmax(0, 1fr)", gap:"9px 14px",
      }}>
        {EDITABLE_PLATFORMS.map(platform => (
          <SocialField
            key={platform}
            platform={platform}
            value={form.socials[platform] || ""}
            onChange={v => set("socials", { ...form.socials, [platform]: v })}
            onReset={() => set("socials", { ...form.socials, [platform]: "" })}
          />
        ))}

        {/* The first website is a standing field like the platforms above;
            the ones after it were added by hand, so those can go again. */}
        {form.websites.map((w, i) => (
          <SocialField
            key={`w${i}`}
            platform="website"
            value={w}
            onChange={v => set("websites", form.websites.map((x, j) => j === i ? v : x))}
            {...(form.websites.length > 1
              ? { onRemove: () => set("websites", form.websites.filter((_, j) => j !== i)) }
              : { onReset: () => set("websites", [""]) })}
          />
        ))}

        {/* dashed = not yet a field, just an invitation to add one. Sized to
            its label rather than to the grid: a full-width dashed box was far
            bigger than the action warranted, but a full cell would read as an
            empty social slot. Hugging the text makes it unmistakably a button. */}
        <button
          onClick={() => set("websites", [...form.websites, ""])}
          style={{
            justifySelf:"start",
            padding:"9px 14px", cursor:"pointer",
            border:"1px dashed #000", background:"transparent",
            fontFamily:"var(--mac-mono)", fontSize:11, color:"var(--ink-2)",
          }}>+ add website</button>
      </div>

      {/* the danger zone belongs to settings, not first-run setup */}
      {!profileOnly && (
        <React.Fragment>
          <DangerZone/>
        </React.Fragment>
      )}
    </div>
  );
}

/* ---------- danger zone ---------- */

// Collapsed by default, destructive actions shouldn't sit in the tab order of
// a form you opened to fix a typo.
function DangerZone() {
  const [open, setOpen] = useState(false);
  return (
    <div style={{ marginTop:26 }}>
      <button
        onClick={() => setOpen(o => !o)}
        style={{
          display:"flex", alignItems:"center", gap:7, padding:0,
          border:"none", background:"transparent", cursor:"pointer",
          fontFamily:"var(--mac-mono)", fontSize:11, fontWeight:700,
          letterSpacing:0.6, color:"var(--ink-warn)", textTransform:"uppercase",
        }}>
        <span style={{
          display:"inline-block",
          transform: open ? "rotate(90deg)" : "none",
        }}>›</span>
        danger zone
      </button>

      {open && (
        <div className="fade-up" style={{
          marginTop:10, padding:"11px 12px",
          border:"1px solid var(--ink-warn)", background:"#FFF3F3",
          display:"flex", alignItems:"center", justifyContent:"space-between", gap:12,
        }}>
          <div style={{ minWidth:0 }}>
            <div style={{
              fontFamily:"var(--mac-mono)", fontSize:12, fontWeight:600, color:"var(--ink-warn)",
            }}>delete account</div>
            <div style={{
              marginTop:3, fontFamily:"var(--mac-sans)", fontSize:12,
              lineHeight:1.45, color:"var(--ink-2)",
            }}>
              index stops immediately and every signal closes. connections
              you've already made stay with the other person.
            </div>
          </div>
          <button style={{
            flex:"0 0 auto",
            fontFamily:"var(--mac-mono)", fontSize:12, padding:"6px 15px",
            border:"1px solid var(--ink-warn)", background:"var(--ink-warn)", color:"#fff",
            boxShadow:"1px 1px 0 rgba(0,0,0,0.2)", cursor:"pointer",
          }}>delete</button>
        </div>
      )}
    </div>
  );
}

/* ---------- pane 2 · notifications ---------- */

// Workbench checkbox, a raised square that fills when checked.
function Toggle({ on, onClick, title, blurb }) {
  return (
    <button
      onClick={onClick}
      role="switch"
      aria-checked={on}
      style={{
        display:"flex", gap:11, alignItems:"flex-start", textAlign:"left",
        width:"100%", padding:"10px 12px", cursor:"pointer",
        border:"1px solid #000", background:"#fff",
        boxShadow:"2px 2px 0 rgba(0,0,0,0.22)",
      }}>
      <span style={{
        flex:"0 0 auto", width:16, height:16, marginTop:1,
        border:"1px solid #000",
        background: on ? "#FF8A00" : "#EDEAE1",
        boxShadow: on
          ? "inset 1px 1px 0 #8A4500, inset -1px -1px 0 #FFD7A0"
          : "inset 1px 1px 0 #FFF, inset -1px -1px 0 var(--ink-3)",
        display:"flex", alignItems:"center", justifyContent:"center",
        fontFamily:"var(--mac-mono)", fontSize:11, fontWeight:700, color:"#000",
      }}>{on ? "✓" : ""}</span>
      <span style={{ minWidth:0 }}>
        <span style={{
          display:"block", fontFamily:"var(--mac-mono)", fontSize:12,
          fontWeight:600, color:"#000",
        }}>{title}</span>
        <span style={{
          display:"block", marginTop:3, fontFamily:"var(--mac-sans)",
          fontSize:12, lineHeight:1.45, color:"var(--ink-2)",
        }}>{blurb}</span>
      </span>
    </button>
  );
}

const NOTIFY_OPTIONS = [
  { id:"alignment", title:"an alignment surfaces",
    blurb:"index found someone worth meeting and wants to hand them over." },
  { id:"accepted",  title:"an intro is accepted",
    blurb:"someone said yes. the chat opens on both sides." },
  { id:"messages",  title:"a message arrives",
    blurb:"someone you're connected with wrote to you while index was in the background." },
  { id:"digest",    title:"daily digest",
    blurb:"one quiet summary each morning instead of live pings." },
];

function NotificationsPane({ notify, toggle }) {
  return (
    <div>
      <p style={{
        margin:"0 0 14px", maxWidth:520,
        fontFamily:"var(--mac-sans)", fontSize:13, lineHeight:1.5, color:"var(--ink-2)",
      }}>
        index works in the background. choose what's worth interrupting you for.
      </p>
      <div style={{ display:"grid", gap:9 }}>
        {NOTIFY_OPTIONS.map(o => (
          <Toggle
            key={o.id}
            on={!!notify[o.id]}
            onClick={() => toggle(o.id)}
            title={o.title}
            blurb={o.blurb}
          />
        ))}
      </div>
    </div>
  );
}

/* ---------- pane 3 · access ---------- */

const accessTh = {
  textAlign:"left", padding:"6px 10px", borderBottom:"1px solid #000",
  fontFamily:"var(--mac-mono)", fontSize:9, fontWeight:700,
  textTransform:"uppercase", letterSpacing:0.5, color:"var(--ink-2)",
};
const accessTd = {
  padding:"7px 10px", borderBottom:"1px solid rgba(0,0,0,0.12)",
  fontFamily:"var(--mac-mono)", fontSize:11, color:"#000", whiteSpace:"nowrap",
};
const accessNote = {
  margin:"0 0 10px", maxWidth:520,
  fontFamily:"var(--mac-sans)", fontSize:12, lineHeight:1.5, color:"var(--ink-2)",
};
const accessHeading = {
  margin:0, fontFamily:"var(--mac-mono)", fontSize:10, fontWeight:700,
  textTransform:"uppercase", letterSpacing:0.6, color:"var(--ink-2)",
};

function accessDay(value) {
  if (!value) return "never";
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "never"
    : date.toLocaleDateString("en-US", { month:"short", day:"numeric", year:"numeric" });
}

function maskKey(start) {
  return start ? `${start}${"*".repeat(24)}` : "unavailable";
}

// The same labels the web access page uses, read off the user agent the device
// grant recorded when the client signed in.
function describeDevice(userAgent) {
  if (!userAgent) return "unknown device";
  if (userAgent.startsWith("Index/")) return "index for mac";
  if (userAgent.startsWith("index-cli")) return "index cli";
  if (userAgent.includes("Hermes")) return "hermes agent";
  if (/Chrome|Safari|Firefox|Edg/.test(userAgent)) return "web browser";
  return userAgent.slice(0, 32);
}

function RetryLink({ onClick }) {
  return (
    <button
      onClick={onClick}
      style={{
        fontFamily:"var(--mac-sans)", fontSize:12, border:"none", background:"none",
        color:"var(--ink-2)", textDecoration:"underline", cursor:"pointer", padding:0,
      }}>retry</button>
  );
}

// Revoking is irreversible and one row looks much like the next, so the button
// asks once. There is no confirm() here: this shell implements only the alert
// panel, so window.confirm would answer false without ever showing anything.
function RevokeButton({ onConfirm, busy }) {
  const [armed, setArmed] = useState(false);
  return (
    <button
      onClick={() => { if (armed) { onConfirm(); setArmed(false); } else setArmed(true); }}
      onBlur={() => setArmed(false)}
      disabled={busy}
      style={{
        fontFamily:"var(--mac-mono)", fontSize:11, padding:"3px 10px",
        border:"1px solid #000", background: armed ? "var(--ink-warn)" : "#fff",
        color: armed ? "#fff" : "var(--ink-warn)",
        boxShadow:"1px 1px 0 rgba(0,0,0,0.2)", cursor: busy ? "default" : "pointer",
      }}>{armed ? "sure?" : "revoke"}</button>
  );
}

// Access mirrors the web settings page: the account's API keys, then every
// session it is signed in on. Key values are never stored here — a freshly
// minted key is held only until the panel is dismissed.
function AccessPane() {
  const [keys, setKeys] = useState(null);
  const [devices, setDevices] = useState(null);
  const [currentId, setCurrentId] = useState(null);
  const [minted, setMinted] = useState(null);
  const [busy, setBusy] = useState(false);
  const [keysError, setKeysError] = useState(null);
  const [devicesError, setDevicesError] = useState(null);

  const app = window.IndexApp;

  // The two lists are fetched independently and fail independently: they sit on
  // different limiters, so one being unavailable must not hide the other.
  const reload = React.useCallback(async () => {
    if (!app || !app.listApiKeys) return;
    const reason = (e) => (e && e.message ? e.message : "could not load");
    const [keyPage, devicePage] = await Promise.allSettled([app.listApiKeys(), app.listDevices()]);

    if (keyPage.status === "fulfilled") {
      setKeys((keyPage.value && keyPage.value.apiKeys) || []);
      setKeysError(null);
    } else setKeysError(reason(keyPage.reason));

    if (devicePage.status === "fulfilled") {
      setDevices((devicePage.value && devicePage.value.devices) || []);
      setCurrentId((devicePage.value && devicePage.value.currentId) || null);
      setDevicesError(null);
    } else setDevicesError(reason(devicePage.reason));
  }, [app]);

  useEffect(() => { reload(); }, [reload]);

  const run = async (work, setError) => {
    setBusy(true);
    try { await work(); await reload(); }
    catch (e) { setError(e && e.message ? e.message : "request failed"); }
    finally { setBusy(false); }
  };

  const generate = () => run(async () => {
    const names = new Set((keys || []).map(k => k.name));
    let name = "Personal";
    for (let n = 2; names.has(name); n += 1) name = `Personal ${n}`;
    const created = await app.createApiKey(name);
    if (created && created.key) setMinted(created.key);
  }, setKeysError);

  if (keys === null && devices === null && !keysError && !devicesError) {
    return <p style={accessNote}>loading…</p>;
  }

  return (
    <div style={{ display:"grid", gap:22 }}>
      <div>
        <div style={{
          display:"flex", alignItems:"center", justifyContent:"space-between",
          gap:12, marginBottom:8,
        }}>
          <p style={accessHeading}>api keys</p>
          <button
            onClick={generate}
            disabled={busy}
            style={{
              fontFamily:"var(--mac-mono)", fontSize:11, padding:"5px 12px",
              border:"1px solid #000", background:"#FF8A00", color:"#000", fontWeight:700,
              boxShadow:"2px 2px 0 rgba(0,0,0,0.22)", cursor: busy ? "default" : "pointer",
            }}>generate key</button>
        </div>

        <p style={accessNote}>
          a key authenticates you in personal agents, mcp clients, and any
          other client.
        </p>

        {keysError ? (
          <p style={accessNote}>{keysError} · <RetryLink onClick={reload}/></p>
        ) : keys === null || keys.length === 0 ? (
          <p style={accessNote}>{keys === null ? "loading…" : "no api keys yet."}</p>
        ) : (
          <div style={{
            border:"1px solid #000", background:"#fff",
            boxShadow:"2px 2px 0 rgba(0,0,0,0.22)", overflowX:"auto",
          }}>
            <table style={{ width:"100%", borderCollapse:"collapse" }}>
              <thead>
                <tr>
                  <th style={accessTh}>key</th>
                  <th style={accessTh}>created</th>
                  <th style={accessTh}>last used</th>
                  <th style={{ ...accessTh, textAlign:"right" }}>actions</th>
                </tr>
              </thead>
              <tbody>
                {keys.map(k => (
                  <tr key={k.id}>
                    <td style={{ ...accessTd, color:"var(--ink-2)" }}>{maskKey(k.start)}</td>
                    <td style={accessTd}>{accessDay(k.createdAt)}</td>
                    <td style={accessTd}>{accessDay(k.lastRequest)}</td>
                    <td style={{ ...accessTd, textAlign:"right" }}>
                      <RevokeButton
                        busy={busy}
                        onConfirm={() => run(() => app.revokeApiKey(k.id), setKeysError)}/>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {minted && (
          <div style={{
            marginTop:10, border:"1px solid #000", background:"#FFF6E5",
            boxShadow:"2px 2px 0 rgba(0,0,0,0.22)", padding:"10px 12px",
          }}>
            <p style={{
              margin:"0 0 6px", fontFamily:"var(--mac-mono)", fontSize:11,
              fontWeight:700, color:"#000",
            }}>copy this key now — it won&apos;t be shown again</p>
            <code style={{
              display:"block", fontFamily:"var(--mac-mono)", fontSize:11,
              color:"#000", wordBreak:"break-all", userSelect:"text",
            }}>{minted}</code>
            <button
              onClick={() => setMinted(null)}
              style={{
                marginTop:8, fontFamily:"var(--mac-mono)", fontSize:10,
                border:"none", background:"none", color:"var(--ink-2)",
                textDecoration:"underline", cursor:"pointer", padding:0,
              }}>dismiss</button>
          </div>
        )}
      </div>

      <div>
        <p style={{ ...accessHeading, marginBottom:8 }}>devices</p>
        <p style={accessNote}>
          where you are signed in. the mac app, cli and personal agents each hold
          their own session, so signing one out here leaves the others alone.
        </p>

        {devicesError ? (
          <p style={accessNote}>{devicesError} · <RetryLink onClick={reload}/></p>
        ) : devices === null || devices.length === 0 ? (
          <p style={accessNote}>{devices === null ? "loading…" : "no active devices."}</p>
        ) : (
          <div style={{
            border:"1px solid #000", background:"#fff",
            boxShadow:"2px 2px 0 rgba(0,0,0,0.22)", overflowX:"auto",
          }}>
            <table style={{ width:"100%", borderCollapse:"collapse" }}>
              <thead>
                <tr>
                  <th style={accessTh}>device</th>
                  <th style={accessTh}>signed in</th>
                  <th style={accessTh}>expires</th>
                  <th style={{ ...accessTh, textAlign:"right" }}>actions</th>
                </tr>
              </thead>
              <tbody>
                {devices.map(d => (
                  <tr key={d.id}>
                    <td style={accessTd}>
                      {describeDevice(d.userAgent)}
                      {d.id === currentId && (
                        <span style={{ marginLeft:6, fontSize:10, color:"var(--ink-2)" }}>this mac</span>
                      )}
                    </td>
                    <td style={accessTd}>{accessDay(d.createdAt)}</td>
                    <td style={accessTd}>{accessDay(d.expiresAt)}</td>
                    <td style={{ ...accessTd, textAlign:"right" }}>
                      <RevokeButton
                        busy={busy}
                        onConfirm={() => (
                          d.id === currentId
                            ? app.logout()
                            : run(() => app.revokeDevice(d.id), setDevicesError)
                        )}/>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

/* ---------- shell ---------- */

// onClose , leave without committing. In settings that closes the pane; at
//            first run there's nothing behind this screen, so the caller sends
//            it back to sign-in. The titlebar gadget uses this too.
// onDone  , the single committing path. Defaults to onClose so the ordinary
//            settings pane behaves exactly as before.
// A public-research enrichment result is "usable" for the review when it filled
// in a bio or discovered at least one social — otherwise we fall through to the
// context/preview drafts below.
function usableEnriched(res) {
  const p = res && res.profile;
  return !!(p && (String(p.intro || "").trim() || (p.socials && p.socials.length)));
}

/** Always one website row to type into, even before there is a website. */
function websiteRows(sites) {
  const kept = (sites || []).filter(s => String(s || "").trim());
  return kept.length ? kept : [""];
}

/** Enrichment fills the blanks; whatever the person typed themselves stands. */
function fillBlankHandles(current, found) {
  const merged = { ...current };
  for (const platform of EDITABLE_PLATFORMS) {
    if (!String(merged[platform] || "").trim()) merged[platform] = found[platform] || "";
  }
  return merged;
}

function Settings({ onClose, onDone, initialTab = "profile", profileOnly = false, enrich = false, enriched = null }) {
  const env = (typeof useIndexEnv === "function") ? useIndexEnv() : { live: false };
  // The signed-in user, mirrored onto INDEX_DATA.ME once the snapshot loads.
  // Live-only: empty when nothing has loaded yet, never a demo identity.
  const ME = env.me || window.INDEX_DATA.ME || {};
  const live = !!(env.live && window.IndexApp && window.IndexApp.isAuthed());
  const client = live && window.IndexApp ? window.IndexApp.getClient() : null;
  const [tab, setTab] = useState(initialTab);
  // What the agent assembled, the baseline "reset" restores to.
  // Socials are normalized on the way in so the fields hold a bare username:
  // the API returns {label, value} with value as a whole URL.
  const stored = splitProfileSocials(ME.socials);
  const assembled = useRef({
    name: ME.name || "", email: ME.email || "", location: ME.location || "",
    intro: ME.intro || "",
    // Keyed by platform, not a list: every field is always on screen so it can
    // be emptied and filled again. `websites` always keeps one row to type in.
    socials: stored.handles,
    websites: websiteRows(stored.websites),
    photo: ME.photo || null,
  });
  const [form, setForm] = useState(assembled.current);
  // In-session edits (ME.notify) win over the durable native store; the
  // defaults only apply on a truly fresh install. `messages` predates neither:
  // older saves without it fall back to on, matching notificationEventAllowed.
  const [notify, setNotify] = useState({
    alignment: true, accepted: true, digest: false, messages: true,
    ...((window.INDEX_NATIVE && window.INDEX_NATIVE.notifyPrefs) || {}),
    ...(ME.notify || {}),
  });

  // Enrichment-backed getting started: adopt POST /enrichment/enrich prefill when
  // the parent already ran it on the setting-up screen.
  const [drafting, setDrafting] = useState(enrich && live && !usableEnriched(enriched));
  useEffect(() => {
    if (!enrich || !live) { setDrafting(false); return; }
    let cancelled = false;
    const adopt = (next) => {
      assembled.current = { ...assembled.current, ...next };
      setForm(f => ({ ...f, ...next }));
    };
    (async () => {
      try {
        const res = enriched;
        const p = res && res.profile;
        if (p && (String(p.intro || "").trim() || (p.socials && p.socials.length))) {
          const found = splitProfileSocials(p.socials);
          const intro = p.intro || "";
          const location = p.location || "";
          adopt({
            name: assembled.current.name || p.name || "",
            location: assembled.current.location || location,
            intro: assembled.current.intro || intro,
            socials: fillBlankHandles(assembled.current.socials, found.handles),
            websites: websiteRows(
              found.websites.length ? found.websites : assembled.current.websites
            ),
          });
        }
      } catch (e) { /* keep assembled /auth/me values */ }
      if (!cancelled) setDrafting(false);
    })();
    return () => { cancelled = true; };
  }, []);


  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));
  const toggle = (id) => setNotify(n => ({ ...n, [id]: !n[id] }));

  // Edited relative to what was assembled, drives whether reset is offered.
  const dirty = JSON.stringify(form) !== JSON.stringify(assembled.current);
  const reset = () => setForm(assembled.current);

  // Write back onto the shared record so the rest of the app (the account row,
  // any pane reopened later) sees the edit, then get out of the way. This is
  // the ONLY path that commits, and at first run the only one that counts as
  // finishing onboarding.
  const save = async () => {
    let photo = form.photo || null;
    let avatarKey = null;
    if (live && client && photo && /^data:/i.test(photo)) {
      // PicturePicker only yields a data URL; upload it so the face survives a
      // relaunch (file:// localStorage does not).
      try {
        avatarKey = await client.storage.uploadAvatar(photo);
        photo = window.IndexApp.avatarUrl(avatarKey);
      } catch (e) { /* keep the local preview; profile text still saves */ }
    }
    // The fields hold a handle or a pasted URL; buildProfileSocials turns both
    // into whole addresses under the labels the rest of the platform reads, and
    // drops the empty ones. ME keeps that same stored shape, so reopening this
    // screen reads its own save exactly as it would read a fresh /auth/me.
    const socials = buildProfileSocials(form.socials, form.websites);
    Object.assign(ME, {
      name: form.name,
      location: form.location,
      intro: form.intro,
      socials,
      websites: (form.websites || []).filter((w) => String(w || "").trim()),
      photo,
      notify,
    });
    // Notification toggles gate real OS toasts now; keep them across relaunch
    // (UserDefaults via Swift — file:// localStorage would forget them).
    if (window.IndexApp && window.IndexApp.setNotifyPrefs) window.IndexApp.setNotifyPrefs(notify);
    if (live && client) {
      await client.auth.updateProfile({
        name: form.name,
        intro: form.intro,
        location: form.location,
        socials,
        ...(avatarKey ? { avatar: avatarKey } : {}),
      }).catch(() => {});
      if (enrich && window.IndexApp && window.IndexApp.confirmOnboardingProfile) {
        await window.IndexApp.confirmOnboardingProfile().catch(() => {});
      }
    }
    (onDone || onClose)();
  };

  return (
    <div style={{
      position:"absolute", inset:0,
      display:"grid", placeItems:"center",
      gridTemplateColumns:"minmax(0, 1fr)",
      padding:"56px 40px", overflow:"auto",
    }}>
      {/* Tabbed settings uses a fixed height so switching panes doesn't jump the
          frame. First-run has no tabs, so it hugs its content and shows the
          whole profile without scrolling (capped to the viewport). */}
      <div style={{
        width:860, maxWidth:"100%",
        height: profileOnly ? undefined : "min(660px, calc(100vh - 112px))",
        maxHeight: "calc(100vh - 112px)",
      }}>
        <MacWindow
          title={profileOnly ? "getting started" : "settings"}
          onClose={onClose}
          style={{ height: profileOnly ? undefined : "100%", maxHeight:"100%", minHeight:0 }}>

          {/* first-run shows only the profile, no notifications / api keys.
              The titlebar already reads "getting started", so repeating
              "getting started" as a heading here was the same words twice; the
              band carries the instruction instead, the one thing the titlebar
              can't say. */}
          {profileOnly ? (
            <div style={{ padding:"14px 24px", borderBottom:"2px solid #000" }}>
              <div style={{
                fontFamily:"var(--mac-sans)", fontSize:13, color:"#000",
              }}>{drafting
                ? "pulling together your profile…"
                : "here's what i pulled together. make sure it's right."}</div>
            </div>
          ) : (
            <div style={{
              padding:"18px 24px 0",
              borderBottom:"2px solid #000",
              display:"flex", alignItems:"center", justifyContent:"space-between", gap:12,
            }}>
              <div style={{ paddingBottom:14 }}>
                <MacSegmented
                  size="lg"
                  value={tab}
                  onChange={setTab}
                  options={[
                    { value:"profile",  label:"profile" },
                    { value:"notify",   label:"notifications" },
                    { value:"keys",     label:"access" },
                  ]}
                />
              </div>
            </div>
          )}

          <div className="mac-scroll" style={{
            flex:"1 1 auto", minHeight:0, overflowY:"auto",
            padding:"20px 24px 22px",
          }}>
            {tab === "profile" && <ProfilePane me={ME} form={form} set={set} profileOnly={profileOnly}/>}
            {tab === "notify"  && <NotificationsPane notify={notify} toggle={toggle}/>}
            {tab === "keys"    && <AccessPane/>}
          </div>

          <div style={{
            borderTop:"2px solid #000", padding:"11px 24px",
            display:"flex", alignItems:"center", justifyContent:"flex-end", gap:10,
          }}>
            {/* Three separate intents, three controls, "cancel" used to mean
                both "undo my edits" and "get me out of here", which is why it
                read as ambiguous next to a confirm button.

                reset     restores the assembled values, stays on the screen
                sign out  leaves without committing (first run only, there is
                          no app behind this screen to fall back to)
                confirm   the only committing action */}
            {profileOnly && dirty && (
              <button
                onClick={reset}
                style={{
                  fontFamily:"var(--mac-mono)", fontSize:13, padding:"7px 17px",
                  border:"1px solid #000", background:"#fff", color:"var(--ink-2)",
                  boxShadow:"1px 1px 0 rgba(0,0,0,0.2)", cursor:"pointer",
                  marginRight:"auto",
                }}>reset</button>
            )}
            <button
              onClick={onClose}
              style={profileOnly ? {
                fontFamily:"var(--mac-mono)", fontSize:12, padding:"7px 10px",
                border:"none", background:"transparent", color:"var(--ink-2)",
                textDecoration:"underline", cursor:"pointer", opacity:0.7,
              } : {
                fontFamily:"var(--mac-mono)", fontSize:13, padding:"7px 17px",
                border:"1px solid #000", background:"#fff", color:"#000",
                boxShadow:"1px 1px 0 rgba(0,0,0,0.2)", cursor:"pointer",
              }}>{profileOnly ? "sign out" : "cancel"}</button>
            <button
              onClick={save}
              style={{
                fontFamily:"var(--mac-mono)", fontSize:13, padding:"7px 19px",
                border:"1px solid #000", background:"#000", color:"#fff",
                boxShadow:"1px 1px 0 rgba(0,0,0,0.2)", cursor:"pointer", fontWeight:700,
              }}>{profileOnly ? "looks good →" : "save changes"}</button>
          </div>
        </MacWindow>
      </div>
    </div>
  );
}
