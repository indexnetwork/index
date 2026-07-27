// Settings — reached from the account chip on the hub. Three panes: what the
// network sees (profile), how the agent interrupts you (notifications), and
// the keys other agents authenticate with.

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

// Sunken well — the inverse of a raised gadget, so inputs read as editable.
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

// Prefix sits in its own raised cell so the editable part is unambiguous.
function SocialField({ prefix, value, onChange }) {
  return (
    <div style={{ display:"flex", border:"1px solid #000", background:"#fff" }}>
      <span style={{
        fontFamily:"var(--mac-mono)", fontSize:11, color:"var(--ink-2)",
        background:"#EDEAE1", padding:"8px 10px",
        borderRight:"1px solid #000", whiteSpace:"nowrap",
        display:"flex", alignItems:"center",
      }}>{prefix}</span>
      <input
        value={value}
        onChange={e => onChange && onChange(e.target.value)}
        style={{ ...inputReset(false), padding:"8px 10px" }}
      />
    </div>
  );
}

function SectionRule({ children }) {
  return <div style={{ marginTop:26 }}><RuleLabel>{children}</RuleLabel></div>;
}

/* ---------- pane 1 · profile ---------- */

// The picture is the control — see PicturePicker in primitives for the shared
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
                border:"1px solid #000",
                boxShadow:"1px 1px 0 rgba(0,0,0,0.2)",
                // same treatment Avatar gives its photos, so an uploaded one
                // doesn't arrive in colour and break the monochrome look
                filter:"grayscale(1) contrast(1.05)",
              }}/>
          : <Avatar name={me.name} size={54}/>}
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
  const { INTRO_MAX } = window.INDEX_DATA;
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
        {/* One column like name/email — a full-width field for "NYC, United
            States" was far more room than the value ever needs. */}
        <TextField
          label="location"
          value={form.location}
          onChange={v => set("location", v)}
        />
      </div>

      <div style={{ marginTop:14 }}>
        <FieldLabel right={
          <span style={{ display:"flex", alignItems:"center", gap:12 }}>
            <button style={{
              border:"none", background:"transparent", padding:0, cursor:"pointer",
              fontFamily:"var(--mac-mono)", fontSize:11, color:"#000",
            }}>✧ regenerate</button>
            <span style={{
              fontFamily:"var(--mac-mono)", fontSize:11,
              color: over ? "var(--ink-warn)" : "var(--ink-2)",
              fontWeight: over ? 700 : 400,
            }}>{form.intro.length}/{INTRO_MAX}</span>
          </span>
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
        {form.socials.map((s, i) => (
          <SocialField
            key={s.id}
            prefix={s.prefix}
            value={s.handle}
            onChange={v => set("socials", form.socials.map(
              (x, j) => j === i ? { ...x, handle: v } : x
            ))}
          />
        ))}

        {form.websites.map((w, i) => (
          <SocialField
            key={`w${i}`}
            prefix="https://"
            value={w}
            onChange={v => set("websites", form.websites.map((x, j) => j === i ? v : x))}
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

      {/* integrations + danger zone belong to settings, not first-run setup */}
      {!profileOnly && (
        <React.Fragment>
          <SectionRule>integrations</SectionRule>

          <div style={{ marginTop:12 }}>
            <div style={{
              border:"1px solid #000", background:"#fff", boxShadow:"2px 2px 0 rgba(0,0,0,0.22)",
              padding:"10px 12px",
              display:"flex", alignItems:"center", justifyContent:"space-between", gap:12,
            }}>
              <div style={{ display:"flex", alignItems:"center", gap:11, minWidth:0 }}>
                <span style={{
                  flex:"0 0 auto", width:26, height:26,
                  border:"1px solid #000", background:"#EDEAE1",
                  display:"flex", alignItems:"center", justifyContent:"center",
                  fontSize:13,
                }}>✉</span>
                <div style={{ minWidth:0 }}>
                  <div style={{
                    fontFamily:"var(--mac-mono)", fontSize:12, fontWeight:600, color:"#000",
                  }}>telegram</div>
                  <div style={{
                    marginTop:2, fontFamily:"var(--mac-sans)", fontSize:12, color:"var(--ink-2)",
                  }}>receive notifications and updates via telegram</div>
                </div>
              </div>
              <button style={{
                flex:"0 0 auto",
                fontFamily:"var(--mac-mono)", fontSize:12, padding:"6px 15px",
                border:"1px solid #000", background:"#fff", color:"#000",
                boxShadow:"1px 1px 0 rgba(0,0,0,0.2)", cursor:"pointer",
              }}>connect</button>
            </div>
          </div>

          <DangerZone/>
        </React.Fragment>
      )}
    </div>
  );
}

/* ---------- danger zone ---------- */

// Collapsed by default — destructive actions shouldn't sit in the tab order of
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

// Workbench checkbox — a raised square that fills when checked.
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
  { id:"question",  title:"a question comes up",
    blurb:"someone on the other side needs an answer only you can give." },
  { id:"accepted",  title:"an intro is accepted",
    blurb:"someone said yes. the chat opens on both sides." },
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

/* ---------- pane 3 · api keys ---------- */

const KEYS = [
  { id:"k1", label:"personal access", key:"idx_live_8f3c…a91e", used:"2 hours ago" },
  { id:"k2", label:"raycast script",  key:"idx_live_2b77…40dd", used:"6 days ago" },
];

function maskKey(key) {
  if (!key) return "";
  return key.length > 12 ? `${key.slice(0, 8)}…${key.slice(-4)}` : key;
}

// Live pane: the mac authenticates with a single CLI API key held in the
// Keychain. It can't be listed/rotated from here (those routes are
// session-only), so we surface the injected key masked and offer revoke, which
// deletes the Keychain credential and signs out via the native bridge.
function LiveApiKeyPane() {
  const native = (window.IndexApp && window.IndexApp.native && window.IndexApp.native()) || {};
  const masked = maskKey(native.apiKey);
  const revoke = () => { if (window.IndexApp) window.IndexApp.logout(); };
  return (
    <div>
      <p style={{
        margin:"0 0 14px", maxWidth:520,
        fontFamily:"var(--mac-sans)", fontSize:13, lineHeight:1.5, color:"var(--ink-2)",
      }}>
        this mac is signed in with a single access key stored in your keychain.
        revoking it signs you out here and stops it working immediately.
      </p>
      <div style={{
        border:"1px solid #000", background:"#fff", boxShadow:"2px 2px 0 rgba(0,0,0,0.22)",
        padding:"10px 12px",
        display:"flex", alignItems:"center", justifyContent:"space-between", gap:12,
      }}>
        <div style={{ minWidth:0 }}>
          <div style={{
            fontFamily:"var(--mac-mono)", fontSize:12, fontWeight:600, color:"#000",
          }}>this mac</div>
          <div style={{
            marginTop:3, fontFamily:"var(--mac-mono)", fontSize:11, color:"var(--ink-2)",
          }}>{masked || "no key"}</div>
        </div>
        <button
          onClick={revoke}
          style={{
            flex:"0 0 auto",
            fontFamily:"var(--mac-mono)", fontSize:12, padding:"6px 14px",
            border:"1px solid #000", background:"#fff", color:"var(--ink-warn)",
            boxShadow:"1px 1px 0 rgba(0,0,0,0.2)", cursor:"pointer",
          }}>revoke & sign out</button>
      </div>
    </div>
  );
}

function ApiKeysPane() {
  return (
    <div>
      <p style={{
        margin:"0 0 14px", maxWidth:520,
        fontFamily:"var(--mac-sans)", fontSize:13, lineHeight:1.5, color:"var(--ink-2)",
      }}>
        keys let other tools act as you on the network. revoke one and it stops
        working immediately.
      </p>

      <div style={{ display:"grid", gap:9 }}>
        {KEYS.map(k => (
          <div key={k.id} style={{
            border:"1px solid #000", background:"#fff", boxShadow:"2px 2px 0 rgba(0,0,0,0.22)",
            padding:"10px 12px",
            display:"flex", alignItems:"center", justifyContent:"space-between", gap:12,
          }}>
            <div style={{ minWidth:0 }}>
              <div style={{
                fontFamily:"var(--mac-mono)", fontSize:12, fontWeight:600, color:"#000",
              }}>{k.label}</div>
              <div style={{
                marginTop:3, fontFamily:"var(--mac-mono)", fontSize:11, color:"var(--ink-2)",
              }}>{k.key} · used {k.used}</div>
            </div>
            <button style={{
              flex:"0 0 auto",
              fontFamily:"var(--mac-mono)", fontSize:12, padding:"6px 14px",
              border:"1px solid #000", background:"#fff", color:"var(--ink-warn)",
              boxShadow:"1px 1px 0 rgba(0,0,0,0.2)", cursor:"pointer",
            }}>revoke</button>
          </div>
        ))}
      </div>

      <button style={{
        marginTop:12,
        fontFamily:"var(--mac-mono)", fontSize:11, padding:"6px 14px",
        border:"1px solid #000", background:"#FF8A00", color:"#000", fontWeight:700,
        boxShadow:"2px 2px 0 rgba(0,0,0,0.22)", cursor:"pointer",
      }}>+ new key</button>
    </div>
  );
}

/* ---------- shell ---------- */

// onClose  — leave without committing. In settings that closes the pane; at
//            first run there's nothing behind this screen, so the caller sends
//            it back to sign-in. The titlebar gadget uses this too.
// onDone   — the single committing path. Defaults to onClose so the ordinary
//            settings pane behaves exactly as before.
function Settings({ onClose, onDone, initialTab = "profile", profileOnly = false }) {
  const { ME } = window.INDEX_DATA;
  const env = (typeof useIndexEnv === "function") ? useIndexEnv() : { live: false };
  const live = !!(env.live && window.IndexApp && window.IndexApp.isAuthed());
  const client = live && window.IndexApp ? window.IndexApp.getClient() : null;
  const [tab, setTab] = useState(initialTab);
  // What the agent assembled — the baseline "reset" restores to.
  const assembled = useRef({
    name: ME.name, email: ME.email, location: ME.location,
    intro: ME.intro, socials: ME.socials, websites: ME.websites,
    photo: ME.photo || null,
  });
  const [form, setForm] = useState(assembled.current);
  const [notify, setNotify] = useState(ME.notify || {
    alignment: true, question: true, accepted: true, digest: false,
  });

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));
  const toggle = (id) => setNotify(n => ({ ...n, [id]: !n[id] }));

  // Edited relative to what was assembled — drives whether reset is offered.
  const dirty = JSON.stringify(form) !== JSON.stringify(assembled.current);
  const reset = () => setForm(assembled.current);

  // Write back onto the shared record so the rest of the app (the account row,
  // any pane reopened later) sees the edit, then get out of the way. This is
  // the ONLY path that commits, and at first run the only one that counts as
  // finishing onboarding.
  const save = () => {
    Object.assign(ME, {
      name: form.name,
      location: form.location,
      intro: form.intro,
      socials: form.socials,
      websites: form.websites,
      photo: form.photo,
      notify,
    });
    if (live && client) {
      client.auth.updateProfile({
        name: form.name,
        intro: form.intro,
        location: form.location,
        socials: (form.socials || [])
          .filter((s) => s && s.handle && s.handle.trim())
          .map((s) => ({ label: s.id || "link", value: s.handle.trim() })),
      }).catch(() => {});
    }
    (onDone || onClose)();
  };

  return (
    <div style={{
      position:"absolute", inset:0,
      display:"grid", placeItems:"center",
      gridTemplateColumns:"minmax(0, 1fr)",
      padding:"32px 40px", overflow:"auto",
    }}>
      {/* Tabbed settings uses a fixed height so switching panes doesn't jump the
          frame. First-run has no tabs, so it hugs its content and shows the
          whole profile without scrolling (capped to the viewport). */}
      <div style={{
        width:860, maxWidth:"100%",
        height: profileOnly ? undefined : "min(660px, calc(100vh - 64px))",
        maxHeight: "calc(100vh - 48px)",
      }}>
        <MacWindow
          title={profileOnly ? "index · getting started" : "index · settings"}
          onClose={onClose}
          style={{ height: profileOnly ? undefined : "100%", maxHeight:"100%", minHeight:0 }}>

          {/* first-run shows only the profile — no notifications / api keys.
              The titlebar already reads "index · getting started", so repeating
              "getting started" as a heading here was the same words twice; the
              band carries the instruction instead — the one thing the titlebar
              can't say. */}
          {profileOnly ? (
            <div style={{ padding:"14px 24px", borderBottom:"2px solid #000" }}>
              <div style={{
                fontFamily:"var(--mac-sans)", fontSize:13, color:"#000",
              }}>here's what i pulled together. make sure it's right.</div>
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
                    { value:"keys",     label:"api keys" },
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
            {tab === "keys"    && (live ? <LiveApiKeyPane/> : <ApiKeysPane/>)}
          </div>

          <div style={{
            borderTop:"2px solid #000", padding:"11px 24px",
            display:"flex", alignItems:"center", justifyContent:"flex-end", gap:10,
          }}>
            {/* Three separate intents, three controls — "cancel" used to mean
                both "undo my edits" and "get me out of here", which is why it
                read as ambiguous next to a confirm button.

                reset     restores the assembled values, stays on the screen
                sign out  leaves without committing (first run only — there is
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
              style={{
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
